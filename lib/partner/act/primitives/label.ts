/**
 * SUNNY UNIVERSAL ACTION LAYER — Label family: artists, the balance ledger, balance cycles, media income, weekly
 * availability (Owner side), beats (assignment / details / delete) and the music library (sketches). Every write goes
 * through the stores the label screens use (label-artists-store, artist-balance-*, media-income-store, availability,
 * beats-store / beat-upload / beat-notify, sketches-store) + lib/writes/label for the Owner push buttons.
 *
 * App rules only (never invented): no release cadence, readiness, inactivity threshold or payout / recoup policy; the
 * ledger, cycles, media income and show money stay separate; none of them stores a currency (₪ by convention —
 * disclosed). A show-synced ledger row (source show / transaction) stays owned by the show sync until it is income.
 */
import type { ArgSpec } from "../types";
import { finishPlan, parseKey, realYmd, refuse, text, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";
import { dupContext, dupGate, dupWarnings, DUP_ARGS, type DupQuery } from "./duplicates";
import { weekDaysFor } from "@/lib/red-artists/week";
import { LABEL_ARTIST_RENAME_NAME_KEYED_DEPENDENTS_HE } from "@/lib/label-identity";
import { countValidDays } from "@/lib/shalev-availability-reminder-pure";

type Ledger = { artistId: string; entryType: string; amount: number; entryDate: string; description: string; note: string; sourceShowId: string | null; sourceTxId: string | null };
type Media = { artistId: string; grossAmount: number; source: string; reportPeriod: string; receivedDate: string | null; status: string; notes: string; updatedAt: string };
type Beat = { name: string; genre: string; musicalKey: string | null; assigned: string };
type SketchV = { title: string; description: string; notes: string; latestVersion: number; archived: boolean; position: number; count: number; rating: number | null };
export interface LabelFamilyWriters {
  readLabelArtistFull(id: string): Promise<{ name: string; status: string; notes: string; portalSlug: string | null } | null>;
  countLabelArtistsNamed(name: string): Promise<number>;
  createLabelArtistRecord(a: { name: string; status: string; notes: string }): Promise<string>;
  renameLabelArtist(id: string, name: string): Promise<"ok" | "duplicate" | "not_found">;
  readLedgerEntry(id: string): Promise<Ledger | null>;
  createLedgerEntry(e: { artistId: string; entryType: string; amount: number; entryDate: string; description: string; note: string }): Promise<string>;
  updateLedgerEntry(id: string, artistId: string, e: { entryType: string; amount: number; entryDate: string; description: string; note: string }): Promise<boolean>;
  deleteLedgerEntry(id: string, artistId: string): Promise<boolean>;
  readCycleState(artistId: string): Promise<{ anchorDate: string | null; currentIndex: number | null; currentEnd: string | null; daysUntilClose: number | null }>;
  setCycleAnchor(artistId: string, date: string, mode: "SET" | "UPDATE"): Promise<void>;
  closeCycle(artistId: string, force: boolean): Promise<void>;
  sendCycleReminder(artistId: string, toOwner: boolean, toArtist: boolean): Promise<{ kind: string; ownerSent?: boolean; artistSent?: boolean }>;
  readMediaRecord(id: string): Promise<Media | null>;
  createMediaRecord(artistId: string, m: { grossAmount: number; source: string; reportPeriod: string; receivedDate: string | null; status: string; notes: string }): Promise<{ ok: boolean; id?: string; message?: string }>;
  updateMediaRecord(id: string, artistId: string, expectedUpdatedAt: string, m: Record<string, unknown>): Promise<{ ok: boolean; message?: string }>;
  cancelMediaRecord(id: string, artistId: string, expectedUpdatedAt: string): Promise<{ ok: boolean; message?: string }>;
  readAvailability(slug: string): Promise<string>;
  saveOwnerAvailability(slug: string, days: Array<{ day: string; date: string; available: boolean; from: string }>): Promise<void>;
  readBeat(id: string): Promise<Beat | null>;
  assignBeat(id: string, slug: string): Promise<{ notified: string | null }>;
  unassignBeat(id: string, slug: string): Promise<void>;
  updateBeatDetails(id: string, f: { name: string; genre: string; musicalKey: string | null }): Promise<"ok" | "duplicate" | "not_found">;
  deleteBeatFully(id: string): Promise<{ ok: boolean; error?: string }>;
  readSketch(slug: string, id: string): Promise<SketchV | null>;
  patchSketch(slug: string, id: string, p: { title?: string; description?: string; notes?: string }): Promise<void>;
  rateSketch(slug: string, id: string, rating: number | null): Promise<void>;
  archiveSketch(slug: string, id: string): Promise<void>;
  orderSketches(slug: string): Promise<string[]>;
  /** The artist's active sketches (id + title) — addressability: a wrong / missing sketch id is answered with these choices. */
  listSketchChoices(slug: string): Promise<Array<{ id: string; title: string }>>;
  reorderSketches(slug: string, ids: string[]): Promise<void>;
  notifySketch(artistId: string, artistName: string, slug: string, sketchId: string): Promise<{ kind: string }>;
  setNextWork(slug: string, sketchId: string, deadline: string | null): Promise<void>;
  setNextRelease(slug: string, sketchId: string, releaseDate: string): Promise<void>;
}

/** Pinned to lib/artist-balance-store, lib/types, lib/beats-store and the portal registry by the family test. */
export const LEDGER_TYPES: readonly string[] = ["הכנסות", "הכנסות צפויות", "תשלומים", "הוצאות", "הוצאות צפויות"];
export const LABEL_ARTIST_STATUS_VALUES: readonly string[] = ["פעיל", "בהשהייה", "לא פעיל"];
export const MEDIA_STATUS_VALUES: readonly string[] = ["התקבל", "צפוי", "בוטל"];
export const BEAT_GENRE_VALUES: readonly string[] = ["dancehall", "rnb", "hiphop", "soul"];
export const SKETCH_NOTIFY_ARTISTS: readonly string[] = ["אבי מולה", "שליו טסמה"];
const KEY_RE = /^(C|C#|D|D#|E|F|F#|G|G#|A|A#|B) (Major|Minor)$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ils = (n: number) => `₪${Number(n).toLocaleString("en-US")}`;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const K = (name: string, required = true): ArgSpec => ({ name, kind: "entityKey", required });
const T = (name: string, required = false): ArgSpec => ({ name, kind: "text", required });
const meta = (he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string, o: Partial<PrimitiveMeta>): PrimitiveMeta =>
  ({ domain: "LABEL", he, en, args, fields, effects: [], riskClass: "SAFE_REVERSIBLE", reversible: "YES", writer, compensation: "a new approved plan restoring the previous value shown in the preview", ...o });
const NO_CUR = "למאזן / למחזורים / להכנסות מדיה אין עמודת מטבע — ₪ כמוסכמה";

async function onArtist(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.labelArtist, ["label-artist"]); if (!k) return refuse("BAD_ENTITY", "צריך אמן לייבל (label-artist:…)");
  const f = await d.readLabelArtistFull(k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את האמן");
  return { key: `label-artist:${k.id}`, id: k.id, label: f.name, fields: { ...f } };
}
const ledgerFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const e = await d.readLedgerEntry(id); return e ? { ...e } : null; };
async function onLedger(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.ledgerEntry, ["ledger-entry"]); if (!k) return refuse("BAD_ENTITY", "צריך רשומת מאזן (ledger-entry:…)");
  const f = await ledgerFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הרשומה");
  return { key: `ledger-entry:${k.id}`, id: k.id, label: `${f.entryType} ${ils(Number(f.amount))} ${f.entryDate}`, fields: f };
}
const mediaFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const m = await d.readMediaRecord(id); return m ? { ...m } : null; };
async function onMedia(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.mediaRecord, ["media-income"]); if (!k) return refuse("BAD_ENTITY", "צריך רשומת מדיה (media-income:…)");
  const f = await mediaFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הרשומה");
  return { key: `media-income:${k.id}`, id: k.id, label: `${f.source} ${f.reportPeriod} ${ils(Number(f.grossAmount))}`, fields: f };
}
const beatFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const b = await d.readBeat(id); return b ? { ...b } : null; };
async function onBeat(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.beat, ["beat"]); if (!k) return refuse("BAD_ENTITY", "צריך ביט (beat:…)");
  const f = await beatFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הביט");
  return { key: `beat:${k.id}`, id: k.id, label: String(f.name), fields: f };
}
/** Sketches live in an artist's portal library: the target is label artist + sketch id (a text id in the manifest). */
const SKETCH_ID = /^[A-Za-z0-9_-]{4,63}$/;
async function onSketch(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const art = await onArtist(d, a); if ("ok" in art) return art;
  if (!art.fields.portalSlug) return refuse("NO_PORTAL", "לאמן הזה אין פורטל / ספריית מוזיקה");
  const choices = async () => { const c = await d.listSketchChoices(String(art.fields.portalSlug)); return c.length ? ` — הסקיצות הפעילות (sketchId — שם): ${c.slice(0, 40).map((x) => `${x.id} — ${x.title.slice(0, 60)}`).join("; ")}` : " — אין סקיצות פעילות"; };
  if (typeof a.sketchId !== "string" || !SKETCH_ID.test(a.sketchId)) return refuse("BAD_ENTITY", `מזהה סקיצה לא תקין${await choices()}`);
  const s = await d.readSketch(String(art.fields.portalSlug), a.sketchId); if (!s) return refuse("ENTITY_NOT_FOUND", `לא מצאתי את הסקיצה${await choices()}`);
  return { key: `sketch:${art.id}.${a.sketchId}`, id: `${art.id}.${a.sketchId}`, label: `${art.label} · ${s.title}`, fields: { ...s, slug: String(art.fields.portalSlug), artistName: String(art.fields.name) } };
}
const splitSk = (id: string) => { const i = id.indexOf("."); return { artistId: id.slice(0, i), sketchId: id.slice(i + 1) }; };
async function sketchRead(d: WriterDeps, id: string): Promise<Fields | null> {
  const { artistId, sketchId } = splitSk(id);
  const art = await d.readLabelArtistFull(artistId); if (!art?.portalSlug) return null;
  const s = await d.readSketch(art.portalSlug, sketchId);
  return s ? { ...s, slug: art.portalSlug, artistName: art.name } : null;
}

/** Duplicate awareness (POLISH FIX #1): the same artist + type + amount, near the date, with a similar description. */
/** the noun in the question (display only — never a type comparison): an expense entry type → הוצאה, an income one → הכנסה */
const ledgerNoun = (a: Readonly<Record<string, unknown>>) => { const t = String(a.entryType); return t.startsWith("הוצאות") ? "הוצאה ".trim() : t.startsWith("הכנסות") ? "הכנסה ".trim() : "רשומה"; };
const ledgerDup = (d: WriterDeps, a: Readonly<Record<string, unknown>>) => {
  const k = parseKey(a.labelArtist, ["label-artist"]);
  const q: DupQuery | null = k && typeof a.amount === "number" && LEDGER_TYPES.includes(String(a.entryType)) ? { kind: "LEDGER_ENTRY", artistId: k.id, entryType: String(a.entryType), amount: a.amount } : null;
  return dupContext(d, q, { date: realYmd(a.entryDate) ? String(a.entryDate) : null, text: [str(a.description), str(a.note)].filter(Boolean).join(" "), currency: "₪" });
};
const mediaDup = (d: WriterDeps, a: Readonly<Record<string, unknown>>) => {
  const k = parseKey(a.labelArtist, ["label-artist"]);
  const q: DupQuery | null = k && typeof a.grossAmount === "number" ? { kind: "MEDIA_INCOME", artistId: k.id, grossAmount: a.grossAmount } : null;
  return dupContext(d, q, { date: realYmd(a.receivedDate) ? String(a.receivedDate) : null, text: [str(a.reportPeriod), str(a.notes)].filter(Boolean).join(" "), currency: "₪" });
};

export const LABEL_PRIMITIVES: readonly PrimitiveSpec[] = [
  // ── artists ──
  {
    actionId: "CREATE_LABEL_ARTIST", kinds: ["label-artist"],
    meta: meta("הוספת אמן ללייבל", "Add a label artist (duplicate names are refused, like the app)", [T("name", true), { name: "status", kind: "enum", required: false, values: LABEL_ARTIST_STATUS_VALUES }, T("notes")], ["name", "status"], "createLabelArtist (lib/label-artists-store)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "set the artist לא פעיל" }),
    createContext: async (d, a) => ({ sameName: typeof a.name === "string" ? await d.countLabelArtistsNamed(a.name.trim()) : 0 }),
    async resolve(d, a) { const n = text(a.name, 120); if (n === null) return refuse("BAD_TEXT", "שם האמן חסר"); return { key: "label-artist:new", id: "new", label: n.trim(), fields: { sameName: await d.countLabelArtistsNamed(n.trim()) } }; },
    read: async (d, id) => { const f = await d.readLabelArtistFull(id); return f ? { ...f } : null; },
    plan(a, cur) { if (Number(cur.sameName) > 0) return refuse("DUPLICATE", "אמן בשם זה כבר קיים"); const n = text(a.name, 120); if (n === null) return refuse("BAD_TEXT", "שם חסר"); return { ok: true, after: { name: n.trim(), status: String(a.status ?? "פעיל") } }; },
    async apply(d, _id, after, a) { return { createdId: await d.createLabelArtistRecord({ name: String(after.name), status: String(after.status), notes: str(a.notes)?.trim() ?? "" }) }; },
    async verify(d, id, after) { const f = await d.readLabelArtistFull(id); return !!f && f.name === after.name; },
    disclosuresHe: ["נוסף אמן לרשימת הלייבל; אין לו פורטל / התחברות (אלה לא נוצרים כאן)", "לא יישלח Push"],
  },
  {
    actionId: "RENAME_LABEL_ARTIST", kinds: ["label-artist"],
    meta: meta("שינוי שם אמן לייבל", "Rename a label artist (the show → ledger link matches the exact roster name — disclosed)", [K("labelArtist"), T("name", true)], ["name"], "updateLabelArtist (lib/label-artists-store)", { riskClass: "BULK", reversible: "PARTIAL" }),
    resolve: onArtist, read: async (d, id) => { const f = await d.readLabelArtistFull(id); return f ? { ...f } : null; },
    plan(a, cur) { const n = text(a.name, 120); if (n === null) return refuse("BAD_TEXT", "שם חסר"); return finishPlan(cur, { name: n.trim() }); },
    async apply(d, id, a) { const r = await d.renameLabelArtist(id, String(a.name)); if (r !== "ok") throw new Error(`rename refused: ${r}`); },
    requiredValues: (_a, after) => [String(after.name)],
    // B4: the id-based parts (Shalev / Avi portals, the release owner's Projects link, the Owner classification ids)
    // survive a rename; everything still keyed on the NAME is listed (the same shared list any rename surface shows).
    warnings: (c) => [`תלויות שעדיין לפי השם "${c.name}" — אחרי השינוי הן לא יזהו את האמן:`, ...LABEL_ARTIST_RENAME_NAME_KEYED_DEPENDENTS_HE, ...(c.portalSlug ? ["לאמן יש פורטל — ה-slug שלו (תיקיות / הגדרות) לא משתנה כאן"] : [])],
    disclosuresHe: ["רק השם ברשימת הלייבל משתנה; טקסט האמן בפרויקטים / הופעות לא משתנה", "לא יישלח Push"],
  },
  // ── ledger ──
  {
    actionId: "ADD_LEDGER_ENTRY", kinds: ["ledger-entry"],
    meta: meta("רשומה במאזן האמן", "Add a balance-ledger entry (income / expected income / payment / expense / expected expense)", [K("labelArtist"), { name: "entryType", kind: "enum", required: true, values: LEDGER_TYPES }, { name: "amount", kind: "money", required: true }, { name: "entryDate", kind: "ymd", required: true }, T("description"), T("note"), ...DUP_ARGS], ["entryType", "amount", "entryDate", "description", "note"], "createArtistBalanceEntry (lib/artist-balance-store)", { effects: ["LEDGER"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: "delete the entry (separate approved action)" }),
    createContext: async (d, a) => { const k = parseKey(a.labelArtist, ["label-artist"]); const f = k ? await d.readLabelArtistFull(k.id) : null; return { artistName: f ? f.name : null, ...(await ledgerDup(d, a)) }; },
    async resolve(d, a) { const r = await onArtist(d, a); if ("ok" in r) return r; return { key: "ledger-entry:new", id: "new", label: `מאזן ${r.label}`, fields: { artistName: r.label, ...(await ledgerDup(d, a)) } }; },
    read: ledgerFields,
    plan(a, cur) {
      if (!LEDGER_TYPES.includes(String(a.entryType))) return refuse("BAD_ENUM", "סוג רשומה לא מוכר");
      if (typeof a.amount !== "number" || !(a.amount > 0)) return refuse("BAD_MONEY", "הסכום חייב להיות חיובי");
      if (!realYmd(a.entryDate)) return refuse("BAD_DATE", "תאריך לא תקין");
      const g = dupGate(a, cur, ledgerNoun(a)); if (g) return g;
      return { ok: true, after: { entryType: String(a.entryType), amount: a.amount, entryDate: String(a.entryDate), description: str(a.description)?.trim() ?? "", note: str(a.note)?.trim() ?? "" } };
    },
    async apply(d, _id, after, a) { return { createdId: await d.createLedgerEntry({ artistId: parseKey(a.labelArtist, ["label-artist"])!.id, entryType: String(after.entryType), amount: Number(after.amount), entryDate: String(after.entryDate), description: str(a.description)?.trim() ?? "", note: str(a.note)?.trim() ?? "" }) }; },
    async verify(d, id, after) { const e = await d.readLedgerEntry(id); return !!e && e.amount === after.amount && e.entryType === after.entryType; },
    requiredValues: (_a, after) => [String(after.entryType), ils(Number(after.amount))],
    warnings: (c, a) => dupWarnings(c, a),
    disclosuresHe: ["רשומה אחת במאזן האמן; הכספים של החברה לא משתנים (מאזן ≠ כספים)", NO_CUR, "לא יישלח Push"],
  },
  {
    actionId: "UPDATE_LEDGER_ENTRY", kinds: ["ledger-entry"],
    meta: meta("עדכון רשומה במאזן", "Edit a ledger entry (type / amount / date / description / note)", [K("ledgerEntry"), { name: "entryType", kind: "enum", required: false, values: LEDGER_TYPES }, { name: "amount", kind: "money", required: false }, { name: "entryDate", kind: "ymd", required: false }, T("description"), T("note")], ["entryType", "amount", "entryDate", "description", "note"], "updateArtistBalanceEntry (lib/artist-balance-store)", { effects: ["LEDGER"], riskClass: "FINANCIAL" }),
    resolve: onLedger, read: ledgerFields,
    plan(a, cur) {
      const after: Fields = {};
      if (a.entryType !== undefined) { if (!LEDGER_TYPES.includes(String(a.entryType))) return refuse("BAD_ENUM", "סוג לא מוכר"); after.entryType = String(a.entryType); }
      if (a.amount !== undefined) { if (typeof a.amount !== "number" || !(a.amount > 0)) return refuse("BAD_MONEY", "סכום חיובי"); after.amount = a.amount; }
      if (a.entryDate !== undefined) { if (!realYmd(a.entryDate)) return refuse("BAD_DATE", "תאריך לא תקין"); after.entryDate = String(a.entryDate); }
      for (const k of ["description", "note"] as const) if (a[k] !== undefined) { const t = text(a[k], 500); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t.trim(); }
      return finishPlan(cur, after);
    },
    async apply(d, id, a) { const e = await d.readLedgerEntry(id); if (!e) throw new Error("entry not found"); const ok = await d.updateLedgerEntry(id, e.artistId, { entryType: String(a.entryType ?? e.entryType), amount: Number(a.amount ?? e.amount), entryDate: String(a.entryDate ?? e.entryDate), description: String(a.description ?? e.description), note: String(a.note ?? e.note) }); if (!ok) throw new Error("entry not found"); },
    requiredValues: (_a, after) => [after.entryType, after.amount !== undefined ? ils(Number(after.amount)) : undefined].filter((x) => x !== undefined).map(String),
    warnings: (c) => (c.sourceTxId && c.entryType === "הכנסות צפויות" ? ["רשומה שמסונכרנת מהופעה: עד שהיא הופכת להכנסה, עריכת ההופעה תחשב אותה מחדש"] : []),
    disclosuresHe: ["רק הרשומה הזאת משתנה; הכספים של החברה לא", NO_CUR, "לא יישלח Push"],
  },
  {
    actionId: "MARK_LEDGER_INCOME_RECEIVED", kinds: ["ledger-entry"],
    meta: meta("סימון הכנסה צפויה במאזן כהתקבלה", "Turn an expected-income ledger entry into income (optionally with the real date); a show-synced row is then frozen", [K("ledgerEntry"), { name: "entryDate", kind: "ymd", required: false }], ["entryType", "entryDate"], "updateArtistBalanceEntry (lib/artist-balance-store)", { effects: ["LEDGER"], riskClass: "FINANCIAL" }),
    resolve: onLedger, read: ledgerFields,
    plan(a, cur) { if (cur.entryType !== "הכנסות צפויות") return refuse("NOT_EXPECTED", "רק 'הכנסות צפויות' מסומנות כהתקבלו"); if (a.entryDate !== undefined && !realYmd(a.entryDate)) return refuse("BAD_DATE", "תאריך לא תקין"); return { ok: true, after: { entryType: "הכנסות", ...(a.entryDate !== undefined ? { entryDate: String(a.entryDate) } : {}) } }; },
    async apply(d, id, a) { const e = await d.readLedgerEntry(id); if (!e) throw new Error("entry not found"); if (!(await d.updateLedgerEntry(id, e.artistId, { entryType: "הכנסות", amount: e.amount, entryDate: String(a.entryDate ?? e.entryDate), description: e.description, note: e.note }))) throw new Error("entry not found"); },
    requiredValues: () => ["הכנסות"],
    warnings: (c) => [`${ils(Number(c.amount))} מ-${c.entryDate}${c.sourceTxId ? " — רשומה מסונכרנת מהופעה: מעכשיו היא קפואה (הסנכרון לא משנה אותה)" : ""}`],
    disclosuresHe: ["רק סוג הרשומה (ותאריך אם ציינת) משתנה; הכספים של החברה לא", "לא יישלח Push"],
  },
  {
    actionId: "DELETE_LEDGER_ENTRY", kinds: ["ledger-entry"],
    meta: meta("מחיקת רשומה מהמאזן", "Delete a ledger entry", [K("ledgerEntry")], ["exists"], "deleteArtistBalanceEntry (lib/artist-balance-store)", { effects: ["LEDGER", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onLedger(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, exists: true } }; },
    async read(d, id) { const f = await ledgerFields(d, id); return f ? { ...f, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { const e = await d.readLedgerEntry(id); if (!e || !(await d.deleteLedgerEntry(id, e.artistId))) throw new Error("entry not found"); },
    async verify(d, id) { return (await d.readLedgerEntry(id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => [`${c.entryType} ${ils(Number(c.amount))} מ-${c.entryDate}`, ...(c.sourceShowId || c.sourceTxId ? ["זו רשומה שמקורה בהופעה — סנכרון עתידי של ההופעה עשוי ליצור אותה מחדש"] : [])],
    disclosuresHe: ["הרשומה נמחקת לצמיתות; הכספים של החברה לא משתנים", "לא יישלח Push"],
  },
  // ── cycles ──
  {
    actionId: "SET_BALANCE_CYCLE_ANCHOR", kinds: ["label-artist"],
    meta: meta("עוגן מחזור המאזן של האמן (קביעה / תיקון)", "Set or correct an artist's balance-cycle anchor date (the app's own cycle rules validate it)", [K("labelArtist"), { name: "anchorDate", kind: "ymd", required: true }], ["anchorDate"], "setBalanceCycleAnchor / updateBalanceCycleAnchor (lib/artist-balance-cycles-store)", { effects: ["LEDGER"], riskClass: "FINANCIAL" }),
    async resolve(d, a) { const r = await onArtist(d, a); if ("ok" in r) return r; return { ...r, fields: { anchorDate: (await d.readCycleState(r.id)).anchorDate } }; },
    read: async (d, id) => ((await d.readLabelArtistFull(id)) ? { anchorDate: (await d.readCycleState(id)).anchorDate } : null),
    plan: (a, cur) => (realYmd(a.anchorDate) ? finishPlan(cur, { anchorDate: String(a.anchorDate) }) : refuse("BAD_DATE", "תאריך לא תקין")),
    async apply(d, id, a) { const cur = await d.readCycleState(id); await d.setCycleAnchor(id, String(a.anchorDate), cur.anchorDate ? "UPDATE" : "SET"); },
    requiredValues: (_a, after) => [String(after.anchorDate)],
    disclosuresHe: ["מחזורי המאזן (חודשיים) מחושבים מהעוגן לפי הכלל של האפליקציה; רשומות המאזן לא משתנות", "לא יישלח Push"],
  },
  {
    actionId: "CLOSE_BALANCE_CYCLE", kinds: ["label-artist"],
    meta: meta("סגירת מחזור המאזן הנוכחי", "Close the artist's current balance cycle (an early close needs force — the app's rule)", [K("labelArtist"), { name: "force", kind: "boolean", required: false }], ["currentIndex"], "closeCurrentBalanceCycle (lib/artist-balance-cycles-store)", { effects: ["LEDGER"], riskClass: "FINANCIAL", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onArtist(d, a); if ("ok" in r) return r; const c = await d.readCycleState(r.id); return { ...r, fields: { currentIndex: c.currentIndex, daysUntilClose: c.daysUntilClose, currentEnd: c.currentEnd } }; },
    async read(d, id) { if (!(await d.readLabelArtistFull(id))) return null; const c = await d.readCycleState(id); return { currentIndex: c.currentIndex, daysUntilClose: c.daysUntilClose, currentEnd: c.currentEnd }; },
    plan(a, cur) { if (cur.currentIndex === null) return refuse("NO_CYCLE", "לא הוגדר מחזור לאמן הזה"); if (Number(cur.daysUntilClose) > 0 && a.force !== true) return refuse("EARLY_CLOSE", `המחזור נסגר רק ב-${cur.currentEnd} — סגירה מוקדמת צריכה force`); return { ok: true, after: { currentIndex: Number(cur.currentIndex) + 1 } }; },
    async apply(d, id, _a, args) { await d.closeCycle(id, args.force === true); },
    requiredValues: (_a, _after) => ["סגירת מחזור"],
    warnings: (c) => [`מחזור ${c.currentIndex} (עד ${c.currentEnd})${Number(c.daysUntilClose) > 0 ? " — סגירה מוקדמת" : ""}`],
    disclosuresHe: ["המחזור נסגר עם היתרה שלו לפי חישוב האפליקציה; רשומות המאזן לא משתנות", "לא יישלח Push (תזכורת היא פעולה נפרדת)"],
  },
  {
    actionId: "SEND_CYCLE_REMINDER", kinds: ["label-artist"],
    meta: meta("תזכורת מחזור מאזן (Push לך / לאמן)", "Send the balance-cycle reminder push to the Owner and / or the artist's push role", [K("labelArtist"), { name: "toOwner", kind: "boolean", required: false }, { name: "toArtist", kind: "boolean", required: false }], ["reminded"], "sendCycleReminder (lib/writes/label)", { effects: ["PUSH"], riskClass: "EXTERNAL_COMMUNICATION", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onArtist(d, a); if ("ok" in r) return r; return { ...r, fields: { ...r.fields, reminded: false, hasCycle: (await d.readCycleState(r.id)).currentIndex !== null } }; },
    async read(d, id) { const f = await d.readLabelArtistFull(id); return f ? { ...f, reminded: false, hasCycle: (await d.readCycleState(id)).currentIndex !== null } : null; },
    plan(a, cur) { if (a.toOwner !== true && a.toArtist !== true) return refuse("NO_RECIPIENT", "למי? לך / לאמן"); if (!cur.hasCycle) return refuse("NO_CYCLE", "לא הוגדר מחזור לאמן הזה"); return { ok: true, after: { reminded: true } }; },
    async apply(d, id, _a, args) { const r = await d.sendCycleReminder(id, args.toOwner === true, args.toArtist === true); if (r.kind !== "ok" || (!r.ownerSent && !r.artistSent)) throw new Error("not sent (no device / no push role)"); return { receipt: `${r.ownerSent ? "owner" : ""}${r.artistSent ? "+artist" : ""}` }; },
    verify: async (_d, _id, _a, out) => typeof out.receipt === "string" && out.receipt.length > 0,
    requiredValues: (a) => [...(a.toOwner === true ? ["אליי"] : []), ...(a.toArtist === true ? ["לאמן"] : [])],
    disclosuresHe: ["Push עם טווח המחזור וכמה ימים נשארו — התוכן נבנה בשרת", "אמן בלי מכשיר / תפקיד Push מדווח כ'לא נשלח' (לא הצלחה)"],
  },
  // ── media income ──
  {
    actionId: "ADD_MEDIA_INCOME", kinds: ["media-income"],
    meta: meta("הכנסת מדיה לאמן (סטרימינג / זכויות)", "Record media income for an artist (the app's RPC splits label / artist share and recoup)", [K("labelArtist"), { name: "grossAmount", kind: "money", required: true }, T("source"), T("reportPeriod", true), { name: "status", kind: "enum", required: false, values: MEDIA_STATUS_VALUES.filter((s) => s !== "בוטל") }, { name: "receivedDate", kind: "ymd", required: false }, T("notes"), ...DUP_ARGS], ["grossAmount", "reportPeriod", "status", "source", "notes"], "createMedia → create_label_media_income RPC (lib/media-income-store)", { effects: ["LEDGER"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: "cancel the record (separate approved action)" }),
    createContext: async (d, a) => { const k = parseKey(a.labelArtist, ["label-artist"]); const f = k ? await d.readLabelArtistFull(k.id) : null; return { artistName: f ? f.name : null, ...(await mediaDup(d, a)) }; },
    async resolve(d, a) { const r = await onArtist(d, a); if ("ok" in r) return r; return { key: "media-income:new", id: "new", label: `מדיה ${r.label}`, fields: { artistName: r.label, ...(await mediaDup(d, a)) } }; },
    read: mediaFields,
    plan(a, cur) {
      if (typeof a.grossAmount !== "number" || !(a.grossAmount > 0)) return refuse("BAD_MONEY", "סכום ברוטו חיובי");
      const p = text(a.reportPeriod, 60); if (p === null) return refuse("BAD_TEXT", "תקופת דוח חסרה");
      if (a.receivedDate !== undefined && !realYmd(a.receivedDate)) return refuse("BAD_DATE", "תאריך לא תקין");
      const g = dupGate(a, cur, "הכנסת מדיה"); if (g) return g;
      return { ok: true, after: { grossAmount: a.grossAmount, reportPeriod: p.trim(), status: String(a.status ?? "התקבל"), source: str(a.source)?.trim() || "Mobile1", notes: str(a.notes)?.trim() ?? "" } };
    },
    async apply(d, _id, after, a) { const r = await d.createMediaRecord(parseKey(a.labelArtist, ["label-artist"])!.id, { grossAmount: Number(after.grossAmount), source: str(a.source)?.trim() || "Mobile1", reportPeriod: String(after.reportPeriod), receivedDate: str(a.receivedDate) ?? null, status: String(after.status), notes: str(a.notes)?.trim() ?? "" }); if (!r.ok || !r.id) throw new Error(`media not recorded: ${r.message ?? "unknown"}`); return { createdId: r.id }; },
    async verify(d, id, after) { const m = await d.readMediaRecord(id); return !!m && m.grossAmount === after.grossAmount && m.status === after.status; },
    requiredValues: (_a, after) => [ils(Number(after.grossAmount)), String(after.reportPeriod)],
    warnings: (c, a) => dupWarnings(c, a),
    disclosuresHe: ["החלוקה בין הלייבל לאמן והקיזוז (recoup) מחושבים בבסיס הנתונים — לא מחדש כאן", "הכנסות מדיה נפרדות מהמאזן ומהכספים", NO_CUR, "לא יישלח Push"],
  },
  {
    actionId: "UPDATE_MEDIA_INCOME", kinds: ["media-income"],
    meta: meta("עדכון הכנסת מדיה", "Edit a media-income record (claimed by its updated_at — a concurrent edit is refused)", [K("mediaRecord"), { name: "grossAmount", kind: "money", required: false }, T("source"), T("reportPeriod"), { name: "status", kind: "enum", required: false, values: MEDIA_STATUS_VALUES.filter((s) => s !== "בוטל") }, { name: "receivedDate", kind: "ymd", required: false }, T("notes")], ["grossAmount", "source", "reportPeriod", "status", "receivedDate", "notes"], "updateMedia → update_label_media_income RPC (lib/media-income-store)", { effects: ["LEDGER"], riskClass: "FINANCIAL" }),
    resolve: onMedia, read: mediaFields,
    plan(a, cur) {
      if (cur.status === "בוטל") return refuse("CANCELLED", "רשומה מבוטלת לא נערכת");
      const after: Fields = {};
      if (a.grossAmount !== undefined) { if (typeof a.grossAmount !== "number" || !(a.grossAmount > 0)) return refuse("BAD_MONEY", "סכום חיובי"); after.grossAmount = a.grossAmount; }
      for (const k of ["source", "reportPeriod", "notes"] as const) if (a[k] !== undefined) { const t = text(a[k], 200); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t.trim(); }
      if (a.status !== undefined) after.status = String(a.status);
      if (a.receivedDate !== undefined) { if (!realYmd(a.receivedDate)) return refuse("BAD_DATE", "תאריך לא תקין"); after.receivedDate = String(a.receivedDate); }
      return finishPlan(cur, after);
    },
    async apply(d, id, a) { const m = await d.readMediaRecord(id); if (!m) throw new Error("record not found"); const r = await d.updateMediaRecord(id, m.artistId, m.updatedAt, { ...a }); if (!r.ok) throw new Error(`media not updated: ${r.message ?? "unknown"}`); },
    requiredValues: (_a, after) => [after.grossAmount !== undefined ? ils(Number(after.grossAmount)) : undefined, after.status].filter((x) => x !== undefined).map(String),
    disclosuresHe: ["החלוקה והקיזוז מחושבים מחדש בבסיס הנתונים", "לא יישלח Push"],
  },
  {
    actionId: "CANCEL_MEDIA_INCOME", kinds: ["media-income"],
    meta: meta("ביטול הכנסת מדיה", "Cancel a media-income record (a received one is reversed by the app's RPC)", [K("mediaRecord")], ["status"], "cancelMedia → cancel_label_media_income RPC (lib/media-income-store)", { effects: ["LEDGER"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    resolve: onMedia, read: mediaFields,
    plan: (_a, cur) => (cur.status === "בוטל" ? refuse("NO_CHANGE_NEEDED", "כבר מבוטלת") : { ok: true, after: { status: "בוטל" } }),
    async apply(d, id) { const m = await d.readMediaRecord(id); if (!m) throw new Error("record not found"); const r = await d.cancelMediaRecord(id, m.artistId, m.updatedAt); if (!r.ok) throw new Error(`not cancelled: ${r.message ?? "unknown"}`); },
    requiredValues: () => ["ביטול"],
    warnings: (c) => [`${c.source} ${c.reportPeriod}: ${ils(Number(c.grossAmount))} (${c.status})${c.status === "התקבל" ? " — הכנסה שהתקבלה מבוטלת בהיפוך (כמו באפליקציה)" : ""}`],
    disclosuresHe: ["הרשומה עוברת ל'בוטל' (לא נמחקת)", "לא יישלח Push"],
  },
  // ── availability ──
  {
    actionId: "SUBMIT_ARTIST_AVAILABILITY", kinds: ["label-artist"],
    meta: meta("הגשת זמינות שבועית לאמן (בשמו, מצד הבעלים)", "Submit an artist's weekly availability as the Owner (same ≥ 2 different days rule; no push)", [K("labelArtist"), { name: "weekStart", kind: "ymd", required: true }, T("slots", true)], ["availability"], "saveAvailability (lib/red-artists/availability)", { effects: ["SETTINGS"], riskClass: "NORMAL_BUSINESS" }),
    async resolve(d, a) { const r = await onArtist(d, a); if ("ok" in r) return r; if (!r.fields.portalSlug) return refuse("NO_PORTAL", "לאמן אין פורטל זמינות"); return { ...r, fields: { availability: await d.readAvailability(String(r.fields.portalSlug)) } }; },
    async read(d, id) { const f = await d.readLabelArtistFull(id); return f?.portalSlug ? { availability: await d.readAvailability(f.portalSlug) } : null; },
    plan(a, cur) {
      if (!realYmd(a.weekStart) || new Date(`${a.weekStart}T00:00:00Z`).getUTCDay() !== 0) return refuse("BAD_DATE", "תחילת שבוע = יום ראשון (YYYY-MM-DD)");
      const week = weekDaysFor(String(a.weekStart));
      const chosen = new Map<string, string>();
      for (const part of String(a.slots ?? "").split(/[;,]/).map((x) => x.trim()).filter(Boolean)) {
        const m = /^(\d{4}-\d{2}-\d{2})\s*[= ]\s*([0-2]\d:[0-5]\d)$/.exec(part);
        if (!m || !TIME.test(m[2]) || !week.some((w) => w.iso === m[1])) return refuse("BAD_SLOTS", "כל חלון: YYYY-MM-DD HH:MM בתוך השבוע");
        chosen.set(m[1], m[2]);
      }
      const days = week.map((w) => ({ day: w.day, date: w.date, available: chosen.has(w.iso), from: chosen.get(w.iso) ?? "" }));
      if (countValidDays(days) < 2) return refuse("TOO_FEW_DAYS", "יש לבחור לפחות שני ימי זמינות שונים");
      return finishPlan(cur, { availability: days.filter((x) => x.available).map((x) => `${x.day} ${x.date} ${x.from}`).join(", ") });
    },
    async apply(d, id, _after, args) {
      const f = await d.readLabelArtistFull(id); if (!f?.portalSlug) throw new Error("no portal");
      const week = weekDaysFor(String(args.weekStart));
      const chosen = new Map(String(args.slots).split(/[;,]/).map((x) => x.trim()).filter(Boolean).map((p) => { const m = /^(\d{4}-\d{2}-\d{2})\s*[= ]\s*(\d{2}:\d{2})$/.exec(p)!; return [m[1], m[2]] as [string, string]; }));
      await d.saveOwnerAvailability(f.portalSlug, week.map((w) => ({ day: w.day, date: w.date, available: chosen.has(w.iso), from: chosen.get(w.iso) ?? "" })));
    },
    requiredValues: (_a, after) => [String(after.availability)],
    disclosuresHe: ["נשמרת זמינות השבוע בשם האמן (נשלח ע\"י הבעלים) — כמו בכפתור שלך בפורטל", "לא יישלח Push"],
  },
  // ── beats ──
  {
    actionId: "ASSIGN_BEAT", kinds: ["beat"],
    meta: meta("שיוך ביט לאמן (+ התראה לאמן על שיוך חדש)", "Assign a beat to a portal artist — a NEW assignment notifies the artist once (the app's exactly-once rule)", [K("beat"), T("artistSlug", true)], ["assigned"], "assignBeatWithNotify (lib/writes/label)", { effects: ["PUSH"], riskClass: "EXTERNAL_COMMUNICATION", reversible: "PARTIAL", compensation: "unassign (separate approved action)" }),
    resolve: onBeat, read: beatFields,
    plan(a, cur) { const s = String(a.artistSlug ?? "").trim(); if (!/^[a-z0-9-]{2,40}$/.test(s)) return refuse("BAD_SLUG", "מזהה פורטל לא תקין"); const set = String(cur.assigned).split(",").filter(Boolean); if (set.includes(s)) return refuse("NO_CHANGE_NEEDED", "כבר משויך"); return { ok: true, after: { assigned: [...set, s].sort().join(",") } }; },
    async apply(d, id, _a, args) { const r = await d.assignBeat(id, String(args.artistSlug).trim()); return { receipt: r.notified }; },
    requiredValues: (a) => [String(a.artistSlug)],
    disclosuresHe: ["שיוך חדש שולח לאמן Push פעם אחת (ואישור אליך); שיוך קיים לא שולח שוב", "הקובץ עצמו לא משתנה"],
  },
  {
    actionId: "UNASSIGN_BEAT", kinds: ["beat"],
    meta: meta("ביטול שיוך ביט מאמן", "Unassign a beat from a portal artist", [K("beat"), T("artistSlug", true)], ["assigned"], "unassignBeatFromArtist (lib/beats-store)", {}),
    resolve: onBeat, read: beatFields,
    plan(a, cur) { const s = String(a.artistSlug ?? "").trim(); const set = String(cur.assigned).split(",").filter(Boolean); if (!set.includes(s)) return refuse("NO_CHANGE_NEEDED", "לא משויך"); return { ok: true, after: { assigned: set.filter((x) => x !== s).join(",") } }; },
    async apply(d, id, _a, args) { await d.unassignBeat(id, String(args.artistSlug).trim()); },
    disclosuresHe: ["האמן לא רואה יותר את הביט בפורטל; לא נשלחת התראה", "הקובץ לא נמחק"],
  },
  {
    actionId: "UPDATE_BEAT_DETAILS", kinds: ["beat"],
    meta: meta("עדכון פרטי ביט (שם / ז'אנר / סולם)", "Update a beat's name / genre / musical key (the file is not replaced)", [K("beat"), T("name"), { name: "genre", kind: "enum", required: false, values: BEAT_GENRE_VALUES }, T("musicalKey")], ["name", "genre", "musicalKey"], "updateBeatMeta (lib/beats-store)", {}),
    resolve: onBeat, read: beatFields,
    plan(a, cur) {
      const after: Fields = {};
      if (a.name !== undefined) { const t = text(a.name, 120); if (t === null) return refuse("BAD_TEXT", "שם לא תקין"); after.name = t.trim(); }
      if (a.genre !== undefined) after.genre = String(a.genre);
      if (a.musicalKey !== undefined) { if (!KEY_RE.test(String(a.musicalKey))) return refuse("BAD_KEY", "סולם: למשל 'A Minor'"); after.musicalKey = String(a.musicalKey); }
      return finishPlan(cur, after);
    },
    async apply(d, id, a) { const b = await d.readBeat(id); if (!b) throw new Error("beat not found"); const r = await d.updateBeatDetails(id, { name: String(a.name ?? b.name), genre: String(a.genre ?? b.genre), musicalKey: (a.musicalKey as string | undefined) ?? b.musicalKey }); if (r !== "ok") throw new Error(`not updated: ${r}`); },
    disclosuresHe: ["רק הפרטים משתנים — הקובץ לא מוחלף; לא נשלחת התראה"],
  },
  {
    actionId: "DELETE_BEAT", kinds: ["beat"],
    meta: meta("מחיקת ביט (והקובץ שלו)", "Delete a beat and its file (only ever inside the beats folder — the app's hard guard)", [K("beat")], ["exists"], "deleteBeatFully (lib/beat-upload)", { effects: ["FILES", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onBeat(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, exists: true } }; },
    async read(d, id) { const f = await beatFields(d, id); return f ? { ...f, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { const r = await d.deleteBeatFully(id); if (!r.ok) throw new Error(`not deleted: ${r.error ?? "unknown"}`); },
    async verify(d, id) { return (await d.readBeat(id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => (String(c.assigned) ? [`משויך ל: ${c.assigned} — השיוכים נמחקים איתו`] : []),
    disclosuresHe: ["הביט והקובץ נמחקים לצמיתות (רק בתוך תיקיית הביטים)", "לא נשלחת התראה"],
  },
  // ── sketches (music library) ──
  {
    actionId: "UPDATE_SKETCH_DETAILS", kinds: ["sketch"],
    meta: meta("עדכון סקיצה (שם / תיאור / הערות)", "Update a sketch's title / description / notes in an artist's library", [K("labelArtist"), T("sketchId", true), T("title"), T("description"), T("notes")], ["title", "description", "notes"], "patchDetails (lib/red-artists/sketches-store)", {}),
    resolve: onSketch, read: sketchRead,
    plan(a, cur) {
      const after: Fields = {};
      for (const k of ["title", "description", "notes"] as const) if (a[k] !== undefined) { const t = text(a[k], k === "title" ? 120 : 2000); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t.trim(); }
      return finishPlan(cur, after);
    },
    async apply(d, id, a) { const { sketchId } = splitSk(id); const f = await sketchRead(d, id); if (!f) throw new Error("sketch not found"); await d.patchSketch(String(f.slug), sketchId, { ...a } as { title?: string }); },
    disclosuresHe: ["האמן רואה את השינוי בספרייה שלו (בלי Push)"],
  },
  {
    actionId: "RATE_SKETCH", kinds: ["sketch"],
    meta: meta("דירוג סקיצה (1–5 / ללא)", "Rate a sketch 1–5 or clear the rating", [K("labelArtist"), T("sketchId", true), { name: "rating", kind: "number", required: false }, { name: "clear", kind: "boolean", required: false }], ["rating"], "setSketchRating (lib/red-artists/sketches-store)", {}),
    resolve: onSketch, read: sketchRead,
    plan(a, cur) { if (a.clear === true) return finishPlan(cur, { rating: null }); const r = Number(a.rating); if (!Number.isInteger(r) || r < 1 || r > 5) return refuse("BAD_NUMBER", "דירוג שלם 1–5"); return finishPlan(cur, { rating: r }); },
    async apply(d, id, a) { const { sketchId } = splitSk(id); const f = await sketchRead(d, id); if (!f) throw new Error("sketch not found"); await d.rateSketch(String(f.slug), sketchId, (a.rating as number | null) ?? null); },
    disclosuresHe: ["דירוג פנימי; לא נשלחת התראה"],
  },
  {
    actionId: "ARCHIVE_SKETCH", kinds: ["sketch"],
    meta: meta("הסרת סקיצה מהספרייה (העברה לארכיון)", "Remove a sketch from an artist's library (soft delete — the app keeps it archived)", [K("labelArtist"), T("sketchId", true)], ["archived"], "softDeleteSketch (lib/red-artists/sketches-store)", { effects: ["DELETION"], riskClass: "DESTRUCTIVE", reversible: "PARTIAL", compensation: null }),
    resolve: onSketch, read: sketchRead,
    plan: (_a, cur) => (cur.archived ? refuse("NO_CHANGE_NEEDED", "כבר בארכיון") : { ok: true, after: { archived: true } }),
    async apply(d, id) { const { sketchId } = splitSk(id); const f = await sketchRead(d, id); if (!f) throw new Error("sketch not found"); await d.archiveSketch(String(f.slug), sketchId); },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["הסקיצה יוצאת מהספרייה (מחיקה רכה — הקבצים נשארים)", "לא נשלחת התראה"],
  },
  {
    actionId: "MOVE_SKETCH", kinds: ["sketch"],
    meta: meta("שינוי מיקום סקיצה בספרייה", "Move a sketch to a position in the artist's library", [K("labelArtist"), T("sketchId", true), { name: "position", kind: "number", required: true }], ["position"], "reorderSketches (lib/red-artists/sketches-store)", {}),
    resolve: onSketch, read: sketchRead,
    plan(a, cur) { const p = Number(a.position); if (!Number.isInteger(p) || p < 1 || p > Number(cur.count)) return refuse("BAD_NUMBER", `מיקום 1–${cur.count}`); return finishPlan(cur, { position: p }); },
    async apply(d, id, a) { const { sketchId } = splitSk(id); const f = await sketchRead(d, id); if (!f) throw new Error("sketch not found"); const ids = (await d.orderSketches(String(f.slug))).filter((x) => x !== sketchId); ids.splice(Number(a.position) - 1, 0, sketchId); await d.reorderSketches(String(f.slug), ids); },
    disclosuresHe: ["רק הסדר בספרייה משתנה"],
  },
  {
    actionId: "NOTIFY_SKETCH", kinds: ["sketch"],
    meta: meta("שליחת התראה על סקיצה לאמן (אבי / שליו)", "Send the artist the 'new / updated sketch' push (Avi / Shalev only; the number comes from the library)", [K("labelArtist"), T("sketchId", true)], ["notified"], "notifySketchToArtist (lib/writes/label)", { effects: ["PUSH"], riskClass: "EXTERNAL_COMMUNICATION", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onSketch(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, notified: false } }; },
    async read(d, id) { const f = await sketchRead(d, id); return f ? { ...f, notified: false } : null; },
    plan: (_a, cur) => (SKETCH_NOTIFY_ARTISTS.includes(String(cur.artistName)) ? { ok: true, after: { notified: true } } : refuse("NOT_ENABLED", "התראת סקיצה קיימת רק לאבי ולשליו")),
    async apply(d, id) { const { artistId, sketchId } = splitSk(id); const f = await sketchRead(d, id); if (!f) throw new Error("sketch not found"); const r = await d.notifySketch(artistId, String(f.artistName), String(f.slug), sketchId); if (r.kind !== "ok") throw new Error(`not sent: ${r.kind}`); return { receipt: "sent" }; },
    verify: async (_d, _id, _a, out) => out.receipt === "sent",
    requiredValues: (_a, _after) => ["התראה"],
    warnings: (c) => [`${c.artistName}: "${c.title}" — גרסה ${c.latestVersion}`],
    disclosuresHe: ["Push לאמן ולך — התוכן והמספר נגזרים מהספרייה", "גרסה שכבר קיבלה התראה עם אותו מזהה לא נכפלת בהיסטוריה"],
  },
  {
    actionId: "SET_NEXT_WORK", kinds: ["sketch"],
    meta: meta("קביעת 'העבודה הבאה' של האמן (+ דדליין)", "Set the artist's 'next work' (a sketch) with an optional deadline, shown in their portal", [K("labelArtist"), T("sketchId", true), { name: "deadline", kind: "ymd", required: false }], ["nextWork"], "setNextWorkConfig (lib/red-artists/sketches-store)", { effects: ["SETTINGS"] }),
    async resolve(d, a) { const r = await onSketch(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, nextWork: false } }; },
    async read(d, id) { const f = await sketchRead(d, id); return f ? { ...f, nextWork: false } : null; },
    plan: (a) => (a.deadline !== undefined && !realYmd(a.deadline) ? refuse("BAD_DATE", "תאריך לא תקין") : { ok: true, after: { nextWork: true } }),
    async apply(d, id, _a, args) { const { sketchId } = splitSk(id); const f = await sketchRead(d, id); if (!f) throw new Error("sketch not found"); await d.setNextWork(String(f.slug), sketchId, str(args.deadline) ?? null); return { receipt: "set" }; },
    verify: async (_d, _id, _a, out) => out.receipt === "set",
    requiredValues: (a) => (a.deadline ? [String(a.deadline)] : []),
    disclosuresHe: ["האמן רואה בפורטל מה העבודה הבאה (ודדליין אם ציינת); לא נשלחת התראה"],
  },
  {
    actionId: "SET_NEXT_RELEASE", kinds: ["sketch"],
    meta: meta("קביעת 'הריליס הבא' של האמן (סקיצה + תאריך)", "Set the artist's 'next release' (a sketch + release date) shown in their portal", [K("labelArtist"), T("sketchId", true), { name: "releaseDate", kind: "ymd", required: true }], ["nextRelease"], "setNextReleaseConfig (lib/red-artists/sketches-store)", { effects: ["SETTINGS"] }),
    async resolve(d, a) { const r = await onSketch(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, nextRelease: false } }; },
    async read(d, id) { const f = await sketchRead(d, id); return f ? { ...f, nextRelease: false } : null; },
    plan: (a) => (realYmd(a.releaseDate) ? { ok: true, after: { nextRelease: true } } : refuse("BAD_DATE", "תאריך לא תקין")),
    async apply(d, id, _a, args) { const { sketchId } = splitSk(id); const f = await sketchRead(d, id); if (!f) throw new Error("sketch not found"); await d.setNextRelease(String(f.slug), sketchId, String(args.releaseDate)); return { receipt: "set" }; },
    verify: async (_d, _id, _a, out) => out.receipt === "set",
    requiredValues: (a) => [String(a.releaseDate)],
    disclosuresHe: ["תצוגה בפורטל בלבד — לא יוצר ריליס ולא משנה פרויקט; לא נשלחת התראה"],
  },
];
