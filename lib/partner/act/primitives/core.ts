/**
 * SUNNY UNIVERSAL ACTION LAYER — the typed primitive framework (pure over injected writer deps).
 *
 * Every primitive reuses the SAME shared server writer the Redbloods UI uses. Kinds: UPDATE (existing record),
 * CREATE (target "new"; the fingerprint covers the creation context, e.g. duplicates), COMMAND (a registered side-effect
 * operation such as a send or a sync), DELETE (exact target + dependents previewed). Sensitive primitives declare the
 * key values highlighted in the preview (requiredValues) — money, recipients, targets, counts. Since 2026-09-27 the Boss
 * never repeats them: "מאשר" approves the exact plan hash.
 *
 * A primitive: resolves + type-checks its target entity, reads the live fields it will touch, validates the typed
 * arguments, computes the exact after-values (no-op → refused), writes ONLY those fields through the shared writer, and
 * verifies by a fresh read. The executor is chosen only by the registered action id.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "../plan";
import { ENTITY_KEY_RE, MAX_TEXT_CHARS, planSafeValue } from "../persist";
import { asApproved } from "../refs";
import type { ArgSpec, EffectKey, PlanStep, RiskClass } from "../types";
import type { DuplicateWriters } from "./duplicates";
import type { PrimitiveExecutor, StepContext } from "../engine";
import { verifyKindOf, type VerifyKind } from "../verify-kind";
import { LABEL_ARTIST_STATUSES, PROJECT_TYPES, RELEASE_STAGES, VICTOR_OUTCOMES, VICTOR_WORK_STATES } from "@/lib/types";

export type Scalar = string | number | boolean | null;
export type Fields = Record<string, Scalar>;
export const MIX_VERSION_STATUSES = ["בבדיקה", "מוכן", "מאושר", "נדחה"] as const;

/** The shared writers + narrow readers each primitive may use (real ones in server.ts; fakes in tests). */
import type { ProjectFamilyWriters } from "./projects";
import type { CrmFamilyWriters } from "./crm";
import type { SessionFamilyWriters } from "./sessions";
import type { FinanceFamilyWriters } from "./finance";
import type { ShowFamilyWriters } from "./shows";
import type { MixFamilyWriters } from "./mix";
import type { VictorFamilyWriters } from "./victor";
import type { LabelFamilyWriters } from "./label";
import type { RedFilmsFamilyWriters } from "./redfilms";
import type { WorklogFamilyWriters } from "./worklog";
import type { DeliveryFamilyWriters } from "./delivery";
import type { SocialFamilyWriters } from "./social";
import type { SystemFamilyWriters } from "./system";
import type { FilesFamilyWriters } from "./files";
import type { BackfillFamilyWriters } from "./backfills";
import type { UploadFamilyWriters } from "./uploads";
import type { LinkFamilyWriters } from "./links";
import type { OwnerInboxFamilyWriters } from "./owner-inbox";
import type { InboxMemoryFamilyWriters } from "./inbox-memory";
/** Every shared writer / narrow reader a primitive may use (composed per family). */
export type WriterDeps = DuplicateWriters & CoreWriters & ProjectFamilyWriters & CrmFamilyWriters & SessionFamilyWriters & FinanceFamilyWriters & ShowFamilyWriters & MixFamilyWriters & VictorFamilyWriters & LabelFamilyWriters & RedFilmsFamilyWriters & WorklogFamilyWriters & DeliveryFamilyWriters & SocialFamilyWriters & SystemFamilyWriters & FilesFamilyWriters & BackfillFamilyWriters & UploadFamilyWriters & LinkFamilyWriters & OwnerInboxFamilyWriters & InboxMemoryFamilyWriters;
export interface CoreWriters {
  readProject(id: string): Promise<{ name: string; notes: string; startDate: string | null; plannedHours: number | null; plannedDays: number | null; projectType: string; parentProject: string; deadline: string | null } | null>;
  writeProject(id: string, patch: Partial<{ notes: string; start_date: string | null; planned_hours: number | null; planned_days: number | null; project_type: string; parent_project: string; deadline: string | null }>): Promise<void>;
  readRelease(projectId: string): Promise<{ projectName: string; releaseStage: string; releaseTargetDate: string | null; nextAction: string; blocker: string; responsible: string; updatedAt: string } | null>;
  writeRelease(projectId: string, expectedUpdatedAt: string, patch: Partial<{ releaseStage: string; releaseTargetDate: string | null; nextAction: string; blocker: string; responsible: string }>): Promise<"ok" | "conflict" | "not_found">;
  readMixWork(id: string): Promise<{ title: string } | null>;
  listMixVersions(workId: string): Promise<Array<{ id: string; label: string; status: string; createdAt: string }>>;
  listMixComments(workId: string): Promise<Array<{ id: string; versionId: string; versionLabel: string; text: string; status: string; timestampSeconds: number | null; createdAt: string }>>;
  readMixComment(id: string): Promise<{ workId: string; versionLabel: string; text: string; status: string } | null>;
  writeMixCommentStatus(id: string, status: "open" | "resolved"): Promise<void>;
  readMixVersion(id: string): Promise<{ workId: string; label: string; status: string } | null>;
  writeMixVersion(id: string, patch: { status?: string; label?: string }): Promise<void>;
  readLabelArtist(id: string): Promise<{ name: string; notes: string; status: string } | null>;
  writeLabelArtist(id: string, patch: { notes?: string; status?: string }): Promise<"ok" | "not_found" | "duplicate">;
  readVictorWork(id: string): Promise<{ title: string; vendorName: string; workState: string | null; outcome: string | null; notes: string } | null>;
  writeVictorWork(id: string, patch: Partial<{ workState: string; outcome: string; notes: string }>): Promise<void>;
}

export type PlanRefusal = { ok: false; code: string; messageHe: string };
/** The contract metadata a primitive carries (the registry builds its READY contract from this — one source). */
export interface PrimitiveMeta {
  domain: string; he: string; en: string;
  args: readonly ArgSpec[];
  /** Live fields the primitive may change (plan changes[].field). */
  fields: readonly string[];
  effects: readonly EffectKey[];
  riskClass: RiskClass;
  reversible: "YES" | "PARTIAL" | "NO";
  /** The shared Redbloods writer(s) it calls. */
  writer: string;
  compensation?: string | null;
}
export interface ResolvedTarget { key: string; id: string; label: string; fields: Fields }
export interface PrimitiveSpec {
  actionId: string;
  meta: PrimitiveMeta;
  /** CREATE primitives: the creation context (fingerprinted for stale detection; target id is "new"). */
  createContext?(d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<Fields>;
  /** Warnings the preview must show (e.g. a record with the same name already exists). */
  warnings?(current: Fields, args?: Readonly<Record<string, unknown>>): string[];
  /** Key values highlighted in the preview (C2 / C3); informational — the approval is bound to the plan hash, not to repeated words. */
  requiredValues?(args: Readonly<Record<string, unknown>>, after: Fields): string[];
  /** Custom verification (creates / commands); default = re-read the target and compare the after-fields. */
  verify?(d: WriterDeps, id: string, after: Fields, output: ApplyOutput): Promise<boolean>;
  /** The entity kind(s) the target key must have. */
  kinds: readonly string[];
  /** Resolve the target from the typed args (direct key, or a parent key + a deterministic selector). */
  resolve(d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal>;
  /** Re-read the same target by id (fingerprint / verify). `args` is given for the fingerprint re-read, so context
   *  that depends on the typed arguments (e.g. the name of a DJ being assigned) is read the same way as in resolve. */
  read(d: WriterDeps, id: string, args?: Readonly<Record<string, unknown>>): Promise<Fields | null>;
  /** Validate the typed args against the live fields → the exact after-values of the changed fields only. */
  plan(args: Readonly<Record<string, unknown>>, current: Fields): { ok: true; after: Fields } | PlanRefusal;
  /** Write ONLY `after` through the shared writer (CREATE returns the new id; COMMAND may return a receipt). */
  apply(d: WriterDeps, id: string, after: Fields, args: Readonly<Record<string, unknown>>): Promise<ApplyOutput | void>;
  /** What the preview must say will NOT happen / derived same-record effects. */
  disclosuresHe: readonly string[];
  /**
   * Opt-in to CHAINED steps (several steps of one plan on the same record, 2026-09-29). Absent = the primitive can never
   * share a record with another step of the same plan (SAME_ENTITY_TWICE, as before). Present = it declares:
   *   derived   — fields of its OWN read view that its shared writer may change BESIDES the planned after-values
   *               (e.g. the linked expense status a mix-price reconcile can touch). Undeclared = assumed none.
   *   tolerates — fields of its read view whose change by an EARLIER step's writer (a declared derived field) does not
   *               change what this step plans / shows. They are left out of this step's fingerprint; at its turn the
   *               engine still re-plans on the fresh state and requires the SAME after-values + warnings (else STALE).
   */
  chain?: { derived(current: Fields, args: Readonly<Record<string, unknown>>): readonly string[]; tolerates?: readonly string[] };
  /**
   * `$step<k>.created` references (2026-09-29): the SECONDARY entityKey arguments that may point at a record an earlier
   * CREATE step of the same plan makes, with the created kinds each accepts (e.g. MOVE_TRANSACTION.toProject: project).
   * The primitive is planned with a stand-in key whose record exists only in the plan's projection; absent = no reference.
   */
  refArgs?: Readonly<Record<string, readonly string[]>>;
  /**
   * The step's OWN target may be a record created earlier in the plan: `arg` carries the reference; `view` is exactly
   * what this primitive's read view shows for a freshly created record of that kind (from the create step's planned
   * values) — the preview's "before" — or null when it cannot be stated. Absent = the target must already exist.
   */
  refTarget?: { arg: string; kinds: readonly string[]; view(createdBy: { actionId: string; after: Fields }): Fields | null };
}

export interface ApplyOutput { createdId?: string; receipt?: Scalar }

// ── chained steps (projected state) ─────────────────────────────────────────────────────────────────────────────────
/** What a chained step is planned / checked against: the approved after-values of EARLIER steps on the same record
 *  (applied only to fields this step's own view reads) and their declared derived fields. */
export interface ChainContext { overlay: Fields; priorDerived: readonly string[]; /** set at execution: canonical {after, warnings} approved for this step */ expect?: string }
/** The projected view: the live fields with the earlier steps' planned values on the SAME field names of this view. */
export function chainView(cur: Fields, overlay: Fields | undefined): Fields {
  if (!overlay) return cur;
  const out: Fields = { ...cur };
  for (const k of Object.keys(overlay)) if (k in cur) out[k] = overlay[k];
  return out;
}
/** The fields a chained step leaves out of its fingerprint (declared-derived by earlier steps AND tolerated), or null when
 *  an earlier step may change a field this step reads and does NOT tolerate (then it can never be proven safe). */
export function chainOmit(spec: PrimitiveSpec, cur: Fields, priorDerived: readonly string[]): string[] | null {
  const hit = priorDerived.filter((f) => f in cur);
  const tol = spec.chain?.tolerates ?? [];
  return hit.every((f) => tol.includes(f)) ? [...new Set(hit)].sort() : null;
}
const omitFields = (f: Fields, omit: readonly string[]): Fields => (omit.length ? Object.fromEntries(Object.entries(f).filter(([k]) => !omit.includes(k))) : f);
/** The fingerprint of a chained step: the projected view minus the tolerated derived fields ("chain" marks it apart). */
export const chainFingerprint = (actionId: string, id: string, view: Fields, omit: readonly string[]) =>
  createHash("sha256").update(canonicalJson({ a: actionId, id, chain: true, omit, f: omitFields(view, omit) })).digest("hex");
// ── references to a record created earlier in the plan ──────────────────────────────────────────────────────────────
/** Created kinds a plan-time projection exists for (the reader a primitive uses to check that such a record exists). */
export const REF_CREATED_KINDS = ["project"] as const;
/** The project meta a freshly created project will have, from the CREATE step's planned values (plan-time only). */
export function newProjectMeta(createdBy: { actionId: string; after: Fields }): Awaited<ReturnType<WriterDeps["readProjectMeta"]>> {
  const a = createdBy.after;
  if (createdBy.actionId !== "CREATE_PROJECT" && createdBy.actionId !== "CREATE_LABEL_SONG") return null;
  return { name: String(a.name ?? ""), artist: String(a.artist ?? ""), status: String(a.status ?? "לא התחיל"), isHidden: false, businessType: createdBy.actionId === "CREATE_LABEL_SONG" ? "לייבל" : String(a.businessType ?? "לקוח"), projectType: String(a.projectType ?? ""), hasRelease: createdBy.actionId === "CREATE_LABEL_SONG" };
}
/**
 * The writer view used ONLY while planning a step that references a record created earlier in the plan: the
 * existence reader answers for the stand-in id with the projected record; every other read / write is the real one
 * (a write while planning never happens — planning only resolves / reads).
 */
export function withPlannedRecords(d: WriterDeps, projects: ReadonlyMap<string, NonNullable<Awaited<ReturnType<WriterDeps["readProjectMeta"]>>>>): WriterDeps {
  if (!projects.size) return d;
  return new Proxy(d, {
    get(t, k) {
      if (k === "readProjectMeta") return async (id: string) => projects.get(String(id).toLowerCase()) ?? t.readProjectMeta(id);
      const v = Reflect.get(t, k);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

/** What the Boss saw for a chained step, in a form the engine can compare exactly at its turn. */
export const chainExpect = (after: Fields, warnings: readonly string[]) => canonicalJson({ after, warnings });

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A stored link as a READ value: a short fingerprint, never the link itself (old links are not read back to Sunny).
 *  A plan's after-value for a typed URL field is the new URL; verification compares its fingerprint to the fresh read. */
export function linkRef(u: unknown): string | null {
  if (typeof u !== "string" || !u.trim()) return null;
  let h = 2166136261; for (let i = 0; i < u.length; i++) { h ^= u.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `link#${h.toString(16).padStart(8, "0")}`;
}
export const refuse = (code: string, messageHe: string): PlanRefusal => ({ ok: false, code, messageHe });
export const isRefusal = (x: unknown): x is PlanRefusal => !!x && typeof x === "object" && (x as { ok?: unknown }).ok === false;
export function parseKey(v: unknown, kinds: readonly string[]): { kind: string; id: string } | null {
  if (typeof v !== "string" || !ENTITY_KEY_RE.test(v)) return null;
  const i = v.indexOf(":");
  const kind = v.slice(0, i), id = v.slice(i + 1);
  return kinds.includes(kind) && /^[0-9a-f-]{36}$/i.test(id) ? { kind, id: id.toLowerCase() } : null;
}
export const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const realYmd = (v: unknown): v is string => typeof v === "string" && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export const text = (v: unknown, max = MAX_TEXT_CHARS): string | null => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v : null);
export const COMMON_NO = ["לא יישלח Push, מייל או הודעה לאף אחד", "היומן ו-Google Tasks לא משתנים", "שום קובץ ושום רשומה כספית לא משתנים"];
/** Notes edit: REPLACE sets the text; APPEND adds a new line after the current text. */
export function notesAfter(args: Readonly<Record<string, unknown>>, current: string, argName: string): string | PlanRefusal {
  const t = text(args[argName]);
  if (t === null) return refuse("BAD_TEXT", `חסר טקסט ל-${argName} (עד ${MAX_TEXT_CHARS} תווים)`);
  if (args.mode !== "REPLACE" && args.mode !== "APPEND") return refuse("BAD_MODE", "צריך לבחור: להחליף את ההערה או להוסיף לה");
  const after = args.mode === "APPEND" ? (current.trim() ? `${current.trimEnd()}\n${t.trim()}` : t.trim()) : t.trim();
  return after;
}
export const unchanged = (current: Fields, after: Fields) => Object.keys(after).every((k) => current[k] === after[k]);
export const noChange = () => refuse("NO_CHANGE_NEEDED", "זה כבר המצב הנוכחי — אין מה לשנות");
export function finishPlan(current: Fields, after: Fields): { ok: true; after: Fields } | PlanRefusal {
  if (!Object.keys(after).length) return refuse("NOTHING_TO_CHANGE", "לא ציינת מה לשנות");
  return unchanged(current, after) ? noChange() : { ok: true, after };
}

// ── readers shared by several primitives ────────────────────────────────────────────────────────────────────────────
export async function projectFields(d: WriterDeps, id: string): Promise<Fields | null> {
  const p = await d.readProject(id);
  return p ? { name: p.name, notes: p.notes, startDate: p.startDate, plannedHours: p.plannedHours, plannedDays: p.plannedDays, projectType: p.projectType, parentProject: p.parentProject, deadline: p.deadline } : null;
}
export async function resolveProject(d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(args.project, ["project"]);
  if (!k) return refuse("BAD_ENTITY", "צריך מפתח פרויקט תקין (project:…)");
  const f = await projectFields(d, k.id);
  if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט");
  return { key: `project:${k.id}`, id: k.id, label: String(f.name), fields: f };
}
export const PROJECT_READ = (d: WriterDeps, id: string) => projectFields(d, id);
export async function releaseFields(d: WriterDeps, projectId: string): Promise<Fields | null> {
  const r = await d.readRelease(projectId);
  return r ? { projectName: r.projectName, releaseStage: r.releaseStage, releaseTargetDate: r.releaseTargetDate, nextAction: r.nextAction, blocker: r.blocker, responsible: r.responsible, updatedAt: r.updatedAt } : null;
}
export async function resolveRelease(d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(args.project, ["project", "release"]);
  if (!k) return refuse("BAD_ENTITY", "צריך מפתח פרויקט תקין (project:…)");
  const f = await releaseFields(d, k.id);
  if (!f) return refuse("ENTITY_NOT_FOUND", "לפרויקט הזה אין רשומת ריליס (הוא לא ריליס של הלייבל)");
  return { key: `project:${k.id}`, id: k.id, label: String(f.projectName), fields: f };
}
export async function commentFields(d: WriterDeps, id: string): Promise<Fields | null> {
  const c = await d.readMixComment(id);
  return c ? { workId: c.workId, versionLabel: c.versionLabel, text: c.text, status: c.status } : null;
}
export function resolveComment(want: "resolved" | "open") {
  return async (d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> => {
    const direct = parseKey(args.mixComment, ["mix-comment"]);
    let id: string | null = direct?.id ?? null;
    if (!id) {
      const w = parseKey(args.mixWork, ["mix-work"]);
      if (!w) return refuse("BAD_ENTITY", "צריך עבודת מיקס (mix-work:…) או הערה מסוימת (mix-comment:…)");
      if (args.which !== "LATEST" && args.which !== (want === "resolved" ? "LATEST_OPEN" : "LATEST_RESOLVED")) return refuse("BAD_SELECTOR", "איזו הערה? (האחרונה / האחרונה הפתוחה / האחרונה שטופלה)");
      if (!(await d.readMixWork(w.id))) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את עבודת המיקס");
      const all = (await d.listMixComments(w.id)).filter((c) => args.which === "LATEST" || c.status === (want === "resolved" ? "open" : "resolved"));
      if (!all.length) return refuse("ENTITY_NOT_FOUND", want === "resolved" ? "אין הערה פתוחה בעבודת המיקס הזאת" : "אין הערה שסומנה כטופלה בעבודת המיקס הזאת");
      id = [...all].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1))[0].id;
    }
    const f = await commentFields(d, id);
    if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את ההערה");
    return { key: `mix-comment:${id}`, id, label: `הערה ב-${f.versionLabel || "גרסה"}`, fields: f };
  };
}
export async function versionFields(d: WriterDeps, id: string): Promise<Fields | null> {
  const v = await d.readMixVersion(id);
  return v ? { workId: v.workId, label: v.label, status: v.status } : null;
}
export async function resolveVersion(d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  let id = parseKey(args.mixVersion, ["mix-version"])?.id ?? null;
  if (!id) {
    const w = parseKey(args.mixWork, ["mix-work"]);
    if (!w || args.which !== "LATEST") return refuse("BAD_ENTITY", "צריך גרסה מסוימת (mix-version:…) או עבודת מיקס + 'האחרונה'");
    if (!(await d.readMixWork(w.id))) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את עבודת המיקס");
    const vs = await d.listMixVersions(w.id);
    if (!vs.length) return refuse("ENTITY_NOT_FOUND", "אין גרסאות בעבודת המיקס הזאת");
    id = [...vs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0].id; // newest upload, never the highest number
  }
  const f = await versionFields(d, id);
  if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הגרסה");
  return { key: `mix-version:${id}`, id, label: `גרסה ${f.label}`, fields: f };
}
export async function artistFields(d: WriterDeps, id: string): Promise<Fields | null> {
  const a = await d.readLabelArtist(id);
  return a ? { name: a.name, notes: a.notes, status: a.status } : null;
}
export async function victorFields(d: WriterDeps, id: string): Promise<Fields | null> {
  const w = await d.readVictorWork(id);
  return w ? { title: w.title, vendorName: w.vendorName, workState: w.workState, outcome: w.outcome, notes: w.notes } : null;
}
export async function resolveVictor(d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(args.victorWork, ["victor-work"]);
  if (!k) return refuse("BAD_ENTITY", "צריך עבודה של ויקטור (victor-work:…)");
  const f = await victorFields(d, k.id);
  if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את העבודה");
  if (f.vendorName !== "victor") return refuse("WRONG_ENTITY_TYPE", "זו לא עבודה של ויקטור");
  return { key: `victor-work:${k.id}`, id: k.id, label: String(f.title), fields: f };
}


// ── executor adapter (engine interface) ─────────────────────────────────────────────────────────────────────────────
/** Fingerprint of exactly the live fields a primitive touches (stale detection). */
export const fieldsFingerprint = (actionId: string, id: string, f: Fields | null) => createHash("sha256").update(canonicalJson({ a: actionId, id, f })).digest("hex");
/** The target id is the step's single resolved entity key. */
export const stepTargetId = (s: PlanStep) => { const k = s.entities[0] ?? ""; return k.slice(k.indexOf(":") + 1); };

/** The live fields a step was planned against: the record (UPDATE / DELETE / COMMAND) or the creation context (CREATE). */
export async function currentOf(spec: PrimitiveSpec, d: WriterDeps, s: { args: Readonly<Record<string, unknown>>; entities: readonly string[] }): Promise<Fields | null> {
  const k = s.entities[0] ?? "";
  const id = k.slice(k.indexOf(":") + 1);
  return spec.createContext && id === "new" ? spec.createContext(d, s.args) : spec.read(d, id, s.args);
}

/**
 * The writer view a step reads its creation context through: records created by EARLIER steps of the same plan
 * (ctx.excludeCreated — ids the engine collected from this run's outputs) are left out of the duplicate reader and the
 * album track order (ADD_ALBUM_TRACK's "taken" numbers), so a plan never goes STALE / trips the duplicate gate on its
 * own creations. Only the REAL created ids are left out (never a match by name / amount / number): every other change
 * (a record someone else added, an edited record, a track number taken elsewhere) still changes the fingerprint → STALE.
 * Never used to hide anything from a preview. A plan that both adds and moves tracks of one album is refused at planning
 * (planWorkflow), so the move never renumbers around tracks its preview did not show.
 */
export function withExcluded(d: WriterDeps, ctx?: StepContext): WriterDeps {
  const ex = new Set((ctx?.excludeCreated ?? []).filter((x) => typeof x === "string" && x));
  if (!ex.size) return d;
  return new Proxy(d, {
    get(t, k) {
      if (k === "similarRecords") return async (q: Parameters<WriterDeps["similarRecords"]>[0]) => (await t.similarRecords(q)).filter((r) => !r.id || !ex.has(String(r.id)));
      if (k === "albumTrackOrder") return async (pid: string) => (await t.albumTrackOrder(pid)).filter((r) => !ex.has(String(r.id)));
      const v = Reflect.get(t, k);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

/** What this primitive's verify proves (claim contract 2026-10-05) — the ONE lookup the engine and the service use. */
export const verifyKindOfSpec = (spec: Pick<PrimitiveSpec, "actionId" | "kinds">): VerifyKind => verifyKindOf(spec.actionId, spec.kinds);

export function executorFor(spec: PrimitiveSpec, d: WriterDeps): PrimitiveExecutor {
  return {
    verifyKind: verifyKindOfSpec(spec),
    async fingerprint(s, ctx) {
      const cur = await currentOf(spec, withExcluded(d, ctx), s);
      if (!ctx?.chain) return fieldsFingerprint(spec.actionId, stepTargetId(s), cur);
      // a chained step: the projected view (earlier steps' approved values on this view's fields), minus tolerated derived
      if (!cur || !spec.chain) return "CHAIN_UNAVAILABLE";
      const view = chainView(cur, ctx.chain.overlay);
      const omit = chainOmit(spec, cur, ctx.chain.priorDerived);
      if (!omit) return "CHAIN_CONFLICT";
      if (ctx.chain.expect !== undefined) {
        // at its turn: the fresh state must still yield EXACTLY the approved change and warnings (else it is STALE)
        const p = spec.plan(s.args, view);
        if (!p.ok || chainExpect(p.after, spec.warnings?.(view, s.args) ?? []) !== ctx.chain.expect) return "CHAIN_EXPECT_MISMATCH";
      }
      return chainFingerprint(spec.actionId, stepTargetId(s), view, omit);
    },
    async matchesPreview(s, map, ctx) {
      // a step with a reference (its record / argument did not exist when it was previewed): the fresh state must show
      // EXACTLY the previewed before-values and yield EXACTLY the previewed after-values (the created id shown as the ref)
      const cur = await currentOf(spec, withExcluded(d, ctx), s);
      if (!cur) return false;
      const p = spec.plan(s.args, cur);
      if (!p.ok) return false;
      const keys = Object.keys(p.after).sort();
      if (keys.join("|") !== s.changes.map((c) => c.field).sort().join("|")) return false;
      return s.changes.every((c) => {
        const before = planSafeValue(cur[c.field]);
        const after = asApproved(p.after[c.field], map);
        return before === c.before && (after === c.after || planSafeValue(after) === c.after);
      });
    },
    async project(s, ctx) {
      const cur = await currentOf(spec, withExcluded(d, ctx), s);
      if (!cur) return null;
      const view = chainView(cur, ctx?.chain?.overlay);
      const p = spec.plan(s.args, view);
      if (!p.ok) return null;
      return { after: p.after, derived: [...(spec.chain?.derived(view, s.args) ?? [])], expect: chainExpect(p.after, spec.warnings?.(view, s.args) ?? []) };
    },
    async execute(s, _prior, ctx) {
      const id = stepTargetId(s);
      const cur = await currentOf(spec, withExcluded(d, ctx), s);
      if (!cur) throw new Error("target not found");
      const p = spec.plan(s.args, cur);
      // a chained step never writes anything other than the change the Boss approved (defence in depth after the check)
      if (ctx?.chain?.expect !== undefined && (!p.ok || chainExpect(p.after, spec.warnings?.(cur, s.args) ?? []) !== ctx.chain.expect)) throw new Error("chained step: the fresh state no longer yields the approved change — nothing written");
      if (!p.ok) {
        if (p.code === "NO_CHANGE_NEEDED") return { changed: false, output: { after: {} } };
        throw new Error(`invalid at execution: ${p.code}`);
      }
      const out = (await spec.apply(d, id, p.after, s.args)) ?? {};
      return { changed: true, output: { after: p.after, ...out } };
    },
    async verify(s, output) {
      const o = (output ?? {}) as { after?: Fields } & ApplyOutput;
      const after = (o.after ?? {}) as Fields;
      const id = o.createdId ?? stepTargetId(s);
      if (spec.verify) return spec.verify(d, id, after, o);
      const now = await spec.read(d, id);
      return !!now && Object.entries(after).every(([k, v]) => now[k] === v || (typeof v === "string" && now[k] === linkRef(v)));
    },
  };
}
