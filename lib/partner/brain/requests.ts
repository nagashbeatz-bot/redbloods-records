/**
 * Sunny Brain v1 — typed input validation + T2 approval-request building. Pure.
 *
 * Mirrors the DB contracts (owner_approval_payload_ok, the observation / intel / link CHECKs) so Sunny gets a clear
 * refusal BEFORE a write; the DB re-checks everything and stays the authority. The Owner-facing summary / risk text of a
 * T2 request is COMPUTED HERE from the exact payload (never free text from the model), so what the Owner reads is what
 * he approves. Nothing here writes, decides or approves.
 */
import { canonicalUrl } from "./url";
import {
  AUTH_SOURCE_KINDS, BRAIN_PLATFORMS, CAUSAL_STATUSES, CONFIDENCES, CONTENT_KINDS, EFFORTS, FAMILY_RE, IDENTITY_KEY_RE, INSIGHT_KINDS, INTEL_AREAS,
  LINK_ROLES, OBS_TYPE_RE, OWNER_SOURCE_KINDS, PURPOSE_HE, PURPOSE_KINDS, REASON_REQUIRED, RECORD_TYPES, RESERVED_LINK_ROLES, SOURCE_REF_OPAQUE_RE,
  TARGET_KINDS, TOPIC_RE, UNIT_RE, URGENCIES, UUID_RE,
} from "./vocab";

export type Check<T> = { ok: true; value: T } | { ok: false; errors: string[] };
type O = Record<string, unknown>;
const isObj = (v: unknown): v is O => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
const validYmd = (v: unknown): v is string => isStr(v) && ymdRe.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const text = (v: unknown, min: number, max: number) => isStr(v) && v === v.trim() && [...v].length >= min && [...v].length <= max;
const ENTITY_KEY_RE = /^(company:REDBLOODS|known:[a-z0-9][a-z0-9-]{1,62}|(project|client|label-artist|dj|show|session|release|transaction):[A-Za-z0-9_-]{1,80}|vendor:(VICTOR|STEVEN))$/;
export const isEntityKey = (v: unknown): v is string => isStr(v) && v.length <= 120 && ENTITY_KEY_RE.test(v);
const unknownKeys = (o: O, allowed: readonly string[]) => Object.keys(o).filter((k) => !allowed.includes(k)).map((k) => `${k}: not accepted`);
const uniq = <T,>(a: T[]) => [...new Set(a)];

// ───────────────────────────── TRACKING_AUTHORIZATION (T2) ─────────────────────────────

export interface NewResourceInput { platform: string; resourceKind: "ACCOUNT" | "PAGE"; identityKey: string; firstHandle?: string; canonicalUrl?: string; displayName?: string }
export interface TrackingRequestInput {
  purposeKind: string; purposeHe: string; resourceIds?: string[]; newResources?: NewResourceInput[]; includeChildResources: boolean;
  entityKeys?: string[]; observationFamilies: string[]; sourceKinds: string[]; insightsAllowed: boolean; recommendationsAllowed: boolean;
  maxObservationsPerDay?: number | null; validFrom: string; validUntil?: string | null; baseAuthorizationId?: string | null;
}
const TRACK_KEYS = ["purposeKind", "purposeHe", "resourceIds", "newResources", "includeChildResources", "entityKeys", "observationFamilies", "sourceKinds", "insightsAllowed", "recommendationsAllowed", "maxObservationsPerDay", "validFrom", "validUntil", "baseAuthorizationId"] as const;

/** sha256 of the canonical URL, hex — the identity of a web PAGE (the DB recomputes and CHECKs it). */
export async function webPageIdentity(url: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return `page:url-sha256:${createHash("sha256").update(url, "utf8").digest("hex")}`;
}

/** Validates and builds the EXACT T2 payload (every key present, booleans required, no defaults invented). */
export async function buildTrackingPayload(raw: unknown, todayIL: string): Promise<Check<O>> {
  if (!isObj(raw)) return { ok: false, errors: ["authorization request: an object"] };
  const e = unknownKeys(raw, TRACK_KEYS);
  const r = raw as Partial<TrackingRequestInput> & O;
  if (!(PURPOSE_KINDS as readonly string[]).includes(String(r.purposeKind))) e.push(`purposeKind: ${PURPOSE_KINDS.join(" | ")}`);
  if (!text(r.purposeHe, 2, 300)) e.push("purposeHe: 2–300 characters (why — in Hebrew)");
  for (const b of ["includeChildResources", "insightsAllowed", "recommendationsAllowed"] as const) if (typeof r[b] !== "boolean") e.push(`${b}: true | false (required — never a default)`);
  const resourceIds = Array.isArray(r.resourceIds) ? r.resourceIds : r.resourceIds === undefined ? [] : null;
  if (!resourceIds || !resourceIds.every((x) => isStr(x) && UUID_RE.test(x))) e.push("resourceIds: resource ids (uuid)");
  const entityKeys = Array.isArray(r.entityKeys) ? r.entityKeys : r.entityKeys === undefined ? [] : null;
  if (!entityKeys || !entityKeys.every(isEntityKey)) e.push("entityKeys: Redbloods entity keys (e.g. label-artist:<id>, company:REDBLOODS)");
  const fam = Array.isArray(r.observationFamilies) ? r.observationFamilies : [];
  if (fam.length < 1 || fam.length > 20 || !fam.every((f) => isStr(f) && FAMILY_RE.test(f))) e.push("observationFamilies: 1–20 families such as INSTAGRAM, YOUTUBE, AUDIENCE");
  const src = Array.isArray(r.sourceKinds) ? r.sourceKinds : [];
  if (src.length < 1 || src.length > 8 || !src.every((s) => (AUTH_SOURCE_KINDS as readonly string[]).includes(String(s)))) e.push(`sourceKinds: 1–8 of ${AUTH_SOURCE_KINDS.join(" | ")}`);
  const newResources: O[] = [];
  const nr = Array.isArray(r.newResources) ? r.newResources : r.newResources === undefined ? [] : null;
  if (!nr) e.push("newResources: a list");
  for (const [i, x] of (nr ?? []).entries()) {
    if (!isObj(x)) { e.push(`newResources[${i}]: an object`); continue; }
    e.push(...unknownKeys(x, ["platform", "resourceKind", "identityKey", "firstHandle", "canonicalUrl", "displayName"]).map((m) => `newResources[${i}].${m}`));
    const platform = String(x.platform), kind = String(x.resourceKind);
    if (!(BRAIN_PLATFORMS as readonly string[]).includes(platform)) { e.push(`newResources[${i}].platform: ${BRAIN_PLATFORMS.join(" | ")}`); continue; }
    if (kind !== "ACCOUNT" && kind !== "PAGE") { e.push(`newResources[${i}].resourceKind: ACCOUNT | PAGE (content is registered later, under an authorization)`); continue; }
    const out: O = { platform, resourceKind: kind };
    let url: string | null = null;
    if (x.canonicalUrl !== undefined) { url = isStr(x.canonicalUrl) ? canonicalUrl(x.canonicalUrl) : null; if (!url) e.push(`newResources[${i}].canonicalUrl: a public https URL`); else out.canonicalUrl = url; }
    if (platform === "web") {
      if (kind !== "PAGE" || !url) { e.push(`newResources[${i}]: a web resource is a PAGE with canonicalUrl`); continue; }
      out.identityKey = await webPageIdentity(url);
    } else {
      let ik = String(x.identityKey ?? "");
      if (/^account:handle:/i.test(ik)) ik = ik.toLowerCase();
      if (!IDENTITY_KEY_RE.test(ik) || ik.split(":")[0] !== kind.toLowerCase()) { e.push(`newResources[${i}].identityKey: '${kind.toLowerCase()}:<stable id>' (e.g. account:handle:nagashbeatz)`); continue; }
      out.identityKey = ik;
    }
    if (x.firstHandle !== undefined) { if (isStr(x.firstHandle) && /^[A-Za-z0-9@._-]{1,60}$/.test(x.firstHandle)) out.firstHandle = x.firstHandle; else e.push(`newResources[${i}].firstHandle: a handle`); }
    if (x.displayName !== undefined) { if (text(x.displayName, 1, 120)) out.displayName = x.displayName; else e.push(`newResources[${i}].displayName: 1–120 characters`); }
    newResources.push(out);
  }
  if (new Set(newResources.map((x) => `${x.platform}|${x.identityKey}`)).size !== newResources.length) e.push("newResources: the same resource twice");
  if ((resourceIds?.length ?? 0) + newResources.length + (entityKeys?.length ?? 0) === 0) e.push("scope: at least one resource or entity");
  if ((resourceIds?.length ?? 0) + newResources.length > 40 || (entityKeys?.length ?? 0) > 40) e.push("scope: at most 40 resources and 40 entities");
  const cap = r.maxObservationsPerDay;
  if (cap !== undefined && cap !== null && !(typeof cap === "number" && Number.isInteger(cap) && cap > 0)) e.push("maxObservationsPerDay: a positive whole number per Israel calendar day, or null (no cap)");
  if (!validYmd(r.validFrom)) e.push("validFrom: YYYY-MM-DD");
  else if (r.validFrom < todayIL) e.push("validFrom: not in the past (an authorization is never backdated)");
  if (r.validUntil !== undefined && r.validUntil !== null && (!validYmd(r.validUntil) || (validYmd(r.validFrom) && r.validUntil < r.validFrom))) e.push("validUntil: YYYY-MM-DD on / after validFrom, or null (no expiry)");
  if (r.baseAuthorizationId !== undefined && r.baseAuthorizationId !== null && !(isStr(r.baseAuthorizationId) && UUID_RE.test(r.baseAuthorizationId))) e.push("baseAuthorizationId: the authorization this one replaces (uuid) or null");
  if (e.length) return { ok: false, errors: e };
  return {
    ok: true,
    value: {
      purposeKind: r.purposeKind, purposeHe: r.purposeHe, resourceIds: uniq(resourceIds!).sort(), newResources, includeChildResources: r.includeChildResources,
      entityKeys: uniq(entityKeys!).sort(), observationFamilies: uniq(fam as string[]).sort(), sourceKinds: uniq(src as string[]).sort(),
      insightsAllowed: r.insightsAllowed, recommendationsAllowed: r.recommendationsAllowed, maxObservationsPerDay: cap ?? null,
      validFrom: r.validFrom, validUntil: r.validUntil ?? null, baseAuthorizationId: r.baseAuthorizationId ?? null,
    },
  };
}

const yesNo = (b: unknown) => (b === true ? "כן" : "לא");
/** The Owner-facing text of a TRACKING_AUTHORIZATION request — derived ONLY from the payload. */
export function trackingSummaryHe(p: O, labels: (key: string) => string = (k) => k): { summaryHe: string; riskHe: string } {
  const res = (p.resourceIds as string[]).length, nr = p.newResources as O[], ents = p.entityKeys as string[];
  const parts = [
    `מטרה: ${PURPOSE_HE[p.purposeKind as keyof typeof PURPOSE_HE] ?? p.purposeKind} — ${p.purposeHe}`,
    nr.length ? `מקורות חדשים: ${nr.map((x) => `${x.platform} ${x.displayName ?? x.firstHandle ?? x.canonicalUrl ?? x.identityKey}`).join(", ")}` : "",
    res ? `מקורות קיימים: ${res}` : "",
    ents.length ? `ישויות: ${ents.map(labels).join(", ")}` : "",
    `כולל תכנים תחת החשבונות: ${yesNo(p.includeChildResources)}`,
    `סוגי מדידה: ${(p.observationFamilies as string[]).join(", ")}`,
    `מקורות קריאה: ${(p.sourceKinds as string[]).join(", ")}`,
    `תובנות: ${yesNo(p.insightsAllowed)} · המלצות: ${yesNo(p.recommendationsAllowed)}`,
    `תקרה ליום: ${p.maxObservationsPerDay ?? "ללא"}`,
    `תוקף: מ-${p.validFrom} ${p.validUntil ? `עד ${p.validUntil}` : "ללא תאריך סיום"}`,
    p.baseAuthorizationId ? "מחליפה הרשאה קיימת (הישנה תסומן כמוחלפת)" : "",
  ].filter(Boolean);
  const risk = [
    "המשמעות: כשתבקש מסאני לבדוק, או כשתאשר הצעה שלה לבדוק מחדש, היא רשאית לשמור את הנתונים שקראה בעמודים הציבוריים האלה (סוגי המדידה שלמעלה) כדי להשוות וללמוד מהם — בלי לבקש אישור חדש לכל מדידה, עד שתבטל או עד תום התוקף.",
    "זו לא הרשאה למעקב רציף: אין בדיקה אוטומטית ברקע, אין סורק ואין תזמון — סאני נכנסת לדפדפן רק כשביקשת או אישרת.",
    p.insightsAllowed === true ? "היא תוכל לרשום תובנות (השערה, לא עובדה)." : "",
    p.recommendationsAllowed === true ? "היא תוכל לרשום המלצות — המלצה לא מבצעת כלום; כל פעולה עדיין דורשת אישור נפרד." : "",
    "אין כאן גישה לסיסמאות, הודעות פרטיות או פעולה בשמך. ביטול אפשרי בכל רגע.",
  ].filter(Boolean);
  return { summaryHe: parts.join("\n"), riskHe: risk.join(" ") };
}

// ───────────────────────────── OBSERVATIONS ─────────────────────────────

const OBS_ITEM_KEYS = ["resourceId", "entityKey", "type", "valueNum", "valueText", "valueBool", "unit", "observedAt", "periodStart", "periodEnd", "sourceType", "sourceKind", "sourceRef", "captureMethod", "confidence", "correctsId"] as const;

/** Validates one observation item. mode SUNNY = EXTERNAL_SOURCE / SYSTEM_RECORD (autonomous); OWNER = OWNER_STATEMENT (T2 only). */
export function checkObservationItem(raw: unknown, mode: "SUNNY" | "OWNER", nowIso: string): Check<O> {
  if (!isObj(raw)) return { ok: false, errors: ["an object"] };
  const e = unknownKeys(raw, OBS_ITEM_KEYS);
  const x = raw;
  const out: O = {};
  const hasRes = x.resourceId !== undefined && x.resourceId !== null, hasEnt = x.entityKey !== undefined && x.entityKey !== null;
  if (hasRes === hasEnt) e.push("subject: exactly one of resourceId | entityKey");
  if (hasRes) { if (isStr(x.resourceId) && UUID_RE.test(x.resourceId)) out.resourceId = x.resourceId; else e.push("resourceId: uuid"); }
  if (hasEnt) { if (isEntityKey(x.entityKey)) out.entityKey = x.entityKey; else e.push("entityKey: a Redbloods entity key"); }
  if (isStr(x.type) && OBS_TYPE_RE.test(x.type)) out.type = x.type; else e.push("type: FAMILY.METRIC (e.g. INSTAGRAM.FOLLOWERS)");
  const vals = (["valueNum", "valueText", "valueBool"] as const).filter((k) => x[k] !== undefined && x[k] !== null);
  if (vals.length !== 1) e.push("value: exactly one of valueNum | valueText | valueBool");
  if (x.valueNum !== undefined && x.valueNum !== null) { if (typeof x.valueNum === "number" && Number.isFinite(x.valueNum) && Math.abs(x.valueNum) < 1e15) out.valueNum = x.valueNum; else e.push("valueNum: a finite number"); }
  if (x.valueText !== undefined && x.valueText !== null) { if (text(x.valueText, 1, 300)) out.valueText = x.valueText; else e.push("valueText: 1–300 characters"); }
  if (x.valueBool !== undefined && x.valueBool !== null) { if (typeof x.valueBool === "boolean") out.valueBool = x.valueBool; else e.push("valueBool: true | false"); }
  if (x.unit !== undefined && x.unit !== null) { if (isStr(x.unit) && UNIT_RE.test(x.unit)) out.unit = x.unit; else e.push("unit: e.g. count, %, ₪"); }
  if (!isStr(x.observedAt) || Number.isNaN(Date.parse(x.observedAt))) e.push("observedAt: ISO time the value was true");
  else if (Date.parse(x.observedAt) > Date.parse(nowIso) + 5 * 60_000) e.push("observedAt: not in the future");
  else out.observedAt = new Date(x.observedAt).toISOString();
  for (const k of ["periodStart", "periodEnd"] as const) if (x[k] !== undefined && x[k] !== null) { if (validYmd(x[k])) out[k] = x[k]; else e.push(`${k}: YYYY-MM-DD`); }
  if (isStr(out.periodStart) && isStr(out.periodEnd) && out.periodEnd < out.periodStart) e.push("periodEnd: on / after periodStart");
  const st = String(x.sourceType ?? ""), sk = String(x.sourceKind ?? ""), cm = String(x.captureMethod ?? "");
  if (mode === "OWNER") {
    if (st !== "OWNER_STATEMENT" || !(OWNER_SOURCE_KINDS as readonly string[]).includes(sk) || cm !== "OWNER_PROVIDED") e.push(`source: Owner values are sourceType OWNER_STATEMENT, sourceKind ${OWNER_SOURCE_KINDS.join(" | ")}, captureMethod OWNER_PROVIDED`);
  } else if (st === "EXTERNAL_SOURCE") {
    if (!["PUBLIC_PROFILE_PAGE", "PUBLIC_CONTENT_PAGE", "WEB_PAGE", "PLATFORM_API"].includes(sk) || !["CLAUDE_READ", "API"].includes(cm)) e.push("source: EXTERNAL_SOURCE = sourceKind PUBLIC_PROFILE_PAGE | PUBLIC_CONTENT_PAGE | WEB_PAGE | PLATFORM_API with captureMethod CLAUDE_READ | API");
  } else if (st === "SYSTEM_RECORD") {
    if (sk !== "REDBLOODS_RECORD" || cm !== "SYSTEM_SNAPSHOT") e.push("source: SYSTEM_RECORD = sourceKind REDBLOODS_RECORD with captureMethod SYSTEM_SNAPSHOT");
  } else e.push("sourceType: EXTERNAL_SOURCE | SYSTEM_RECORD (an Owner-given value needs his approval — request OWNER_OBSERVATIONS)");
  out.sourceType = st; out.sourceKind = sk; out.captureMethod = cm;
  const cf = String(x.confidence ?? "");
  if (!(CONFIDENCES as readonly string[]).includes(cf)) e.push(`confidence: ${CONFIDENCES.join(" | ")}`);
  else if (st === "EXTERNAL_SOURCE" && cf === "CONFIRMED") e.push("confidence: an external reading is never CONFIRMED (HIGH / MEDIUM / LOW)");
  out.confidence = cf;
  if (x.sourceRef !== undefined && x.sourceRef !== null) {
    if (isStr(x.sourceRef) && x.sourceRef.startsWith("https://")) { const c = canonicalUrl(x.sourceRef); if (c && [...c].length <= 500) out.sourceRef = c; else e.push("sourceRef: a public https URL"); }
    else if (isStr(x.sourceRef) && SOURCE_REF_OPAQUE_RE.test(x.sourceRef)) out.sourceRef = x.sourceRef;
    else e.push("sourceRef: a public https URL or redbloods:<ref> / owner:<ref>");
  }
  if (x.correctsId !== undefined && x.correctsId !== null) { if (isStr(x.correctsId) && UUID_RE.test(x.correctsId)) out.correctsId = x.correctsId; else e.push("correctsId: uuid of the INVALIDATED reading this corrects"); }
  return e.length ? { ok: false, errors: e } : { ok: true, value: out };
}

export function checkObservationBatch(raw: unknown, mode: "SUNNY" | "OWNER", nowIso: string): Check<O[]> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 40) return { ok: false, errors: ["items: 1–40 observations"] };
  const out: O[] = [], e: string[] = [];
  raw.forEach((x, i) => { const c = checkObservationItem(x, mode, nowIso); if (c.ok) out.push(c.value); else e.push(...c.errors.map((m) => `items[${i}].${m}`)); });
  if (!e.length && new Set(out.map((x) => JSON.stringify(x))).size !== out.length) e.push("items: the same observation twice");
  return e.length ? { ok: false, errors: e } : { ok: true, value: out };
}

export function ownerObservationsSummaryHe(items: O[], labels: (key: string) => string = (k) => k): { summaryHe: string; riskHe: string } {
  const lines = items.slice(0, 40).map((x) => `${x.entityKey ? labels(String(x.entityKey)) : `מקור ${String(x.resourceId).slice(0, 8)}`} · ${x.type} = ${x.valueNum ?? x.valueText ?? (x.valueBool === undefined ? "" : yesNo(x.valueBool))}${x.unit ? ` ${x.unit}` : ""} (נכון ל-${String(x.observedAt).slice(0, 10)})`);
  return { summaryHe: `ערכים שמסרת לסאני (${items.length}):\n${lines.join("\n")}`, riskHe: "הערכים יירשמו כמדידות שמסרת (OWNER_STATEMENT) — מדידה בלבד, לא משנה שום רשומה עסקית. ערך שגוי אפשר לבטל ולתקן." };
}

// ───────────────────────────── INTEL RECORDS + LINKS ─────────────────────────────

const LINK_KEYS = ["role", "fromRecord", "fromObs", "fromRef", "toRecord", "toResource", "toRef", "noteHe"] as const;
export function checkLinks(raw: unknown, allowSelf: boolean): Check<O[]> {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw) || raw.length > 40) return { ok: false, errors: ["links: at most 40"] };
  const e: string[] = [], out: O[] = [];
  const idOrSelf = (v: unknown) => isStr(v) && (UUID_RE.test(v) || (allowSelf && v === "$self"));
  raw.forEach((l, i) => {
    if (!isObj(l)) { e.push(`links[${i}]: an object`); return; }
    e.push(...unknownKeys(l, LINK_KEYS).map((m) => `links[${i}].${m}`));
    const role = String(l.role);
    if ((RESERVED_LINK_ROLES as readonly string[]).includes(role)) e.push(`links[${i}].role: ${role} is reserved (not active in v1)`);
    else if (!(LINK_ROLES as readonly string[]).includes(role)) e.push(`links[${i}].role: ${LINK_ROLES.join(" | ")}`);
    const from = (["fromRecord", "fromObs", "fromRef"] as const).filter((k) => l[k] !== undefined), to = (["toRecord", "toResource", "toRef"] as const).filter((k) => l[k] !== undefined);
    if (from.length !== 1 || to.length !== 1) e.push(`links[${i}]: exactly one from (fromRecord | fromObs | fromRef) and one to (toRecord | toResource | toRef)`);
    for (const k of ["fromRecord", "toRecord"] as const) if (l[k] !== undefined && !idOrSelf(l[k])) e.push(`links[${i}].${k}: a record id${allowSelf ? " or \"$self\"" : ""}`);
    for (const k of ["fromObs", "toResource"] as const) if (l[k] !== undefined && !(isStr(l[k]) && UUID_RE.test(l[k] as string))) e.push(`links[${i}].${k}: uuid`);
    for (const k of ["fromRef", "toRef"] as const) if (l[k] !== undefined && !(isStr(l[k]) && [...(l[k] as string)].length >= 3 && [...(l[k] as string)].length <= 120)) e.push(`links[${i}].${k}: an entity key, plan:<id> or (from only) knowledge: / inbox: / context:<uuid>`);
    if (isStr(l.toRef) && /^(knowledge|inbox|context):/.test(l.toRef)) e.push(`links[${i}].toRef: no link may END at Owner memory in v1 (cite it as fromRef evidence instead)`);
    if (l.noteHe !== undefined && !text(l.noteHe, 1, 200)) e.push(`links[${i}].noteHe: 1–200 characters`);
    out.push(Object.fromEntries(LINK_KEYS.filter((k) => l[k] !== undefined).map((k) => [k, l[k]])));
  });
  return e.length ? { ok: false, errors: e } : { ok: true, value: out };
}

const INSIGHT_BODY = { allowed: ["statementHe", "insightKind", "reasoningHe", "causalStatus", "counterEvidenceHe", "periodFrom", "periodTo"], required: ["statementHe", "insightKind", "causalStatus"] };
const REC_BODY = { allowed: ["recommendationHe", "presentedHe", "whyHe", "expectedEffectHe", "effort", "urgency"], required: ["recommendationHe", "presentedHe"] };
export interface IntelInput { recordType: string; entityKeys?: string[]; resourceIds?: string[]; topic?: string | null; area: string; titleHe: string; body: O; confidence: string; reviewAt?: string | null; supersedesId?: string | null; supersedeReason?: string | null; links?: O[] }
const INTEL_KEYS = ["recordType", "entityKeys", "resourceIds", "topic", "area", "titleHe", "body", "confidence", "reviewAt", "supersedesId", "supersedeReason", "links"] as const;

export function checkIntel(raw: unknown): Check<IntelInput & { links: O[] }> {
  if (!isObj(raw)) return { ok: false, errors: ["record: an object"] };
  const e = unknownKeys(raw, INTEL_KEYS);
  const r = raw as Partial<IntelInput> & O;
  const type = String(r.recordType);
  if (!(RECORD_TYPES as readonly string[]).includes(type)) e.push(`recordType: ${RECORD_TYPES.join(" | ")} (OUTCOME / EXPERIMENT are reserved)`);
  const ents = r.entityKeys ?? [], res = r.resourceIds ?? [];
  if (!Array.isArray(ents) || ents.length > 8 || !ents.every(isEntityKey)) e.push("entityKeys: at most 8 Redbloods entity keys");
  if (!Array.isArray(res) || res.length > 8 || !res.every((x) => isStr(x) && UUID_RE.test(x))) e.push("resourceIds: at most 8 resource ids");
  if (Array.isArray(ents) && Array.isArray(res) && ents.length + res.length < 1) e.push("subject: at least one entity or resource");
  if (r.topic !== undefined && r.topic !== null && !(isStr(r.topic) && TOPIC_RE.test(r.topic))) e.push("topic: e.g. instagram.reels_reach");
  if (!(INTEL_AREAS as readonly string[]).includes(String(r.area))) e.push(`area: ${INTEL_AREAS.join(" | ")}`);
  if (!text(r.titleHe, 2, 160)) e.push("titleHe: 2–160 characters");
  if (!["HIGH", "MEDIUM", "LOW"].includes(String(r.confidence))) e.push("confidence: HIGH | MEDIUM | LOW (an inference is never CONFIRMED)");
  if (r.reviewAt !== undefined && r.reviewAt !== null && !validYmd(r.reviewAt)) e.push("reviewAt: YYYY-MM-DD (read-only context — nothing is reviewed automatically)");
  if (r.supersedesId !== undefined && r.supersedesId !== null && !(isStr(r.supersedesId) && UUID_RE.test(r.supersedesId))) e.push("supersedesId: uuid of an OPEN record of the same type");
  if (r.supersedeReason !== undefined && r.supersedeReason !== null && !text(r.supersedeReason, 1, 300)) e.push("supersedeReason: 1–300 characters");
  const b = r.body;
  const spec = type === "RECOMMENDATION" ? REC_BODY : INSIGHT_BODY;
  if (!isObj(b)) e.push("body: an object");
  else {
    for (const k of spec.required) if (b[k] === undefined) e.push(`body.${k}: required`);
    for (const [k, v] of Object.entries(b)) {
      if (!spec.allowed.includes(k)) { e.push(`body.${k}: not accepted for ${type}`); continue; }
      const okv = (isStr(v) && [...v].length >= 1 && [...v].length <= 600) || typeof v === "number" || (Array.isArray(v) && v.length <= 12 && v.every((s) => isStr(s) && [...s].length >= 1 && [...s].length <= 200));
      if (!okv) e.push(`body.${k}: text (≤ 600), a number, or ≤ 12 short texts`);
    }
    if (type === "INSIGHT" && !(INSIGHT_KINDS as readonly string[]).includes(String(b.insightKind))) e.push(`body.insightKind: ${INSIGHT_KINDS.join(" | ")}`);
    if (type === "INSIGHT" && !(CAUSAL_STATUSES as readonly string[]).includes(String(b.causalStatus))) e.push(`body.causalStatus: ${CAUSAL_STATUSES.join(" | ")} (correlation is never cause)`);
    if (type === "RECOMMENDATION" && b.effort !== undefined && !(EFFORTS as readonly string[]).includes(String(b.effort))) e.push(`body.effort: ${EFFORTS.join(" | ")}`);
    if (type === "RECOMMENDATION" && b.urgency !== undefined && !(URGENCIES as readonly string[]).includes(String(b.urgency))) e.push(`body.urgency: ${URGENCIES.join(" | ")}`);
    if (JSON.stringify(b).length > 4000) e.push("body: too long");
  }
  const links = checkLinks(r.links, true);
  if (!links.ok) e.push(...links.errors);
  else if (type === "INSIGHT" && !links.value.some((l) => l.role === "EVIDENCE_FOR" && l.toRecord === "$self")) e.push("links: an INSIGHT needs at least one EVIDENCE_FOR link to \"$self\" (no evidence, no insight)");
  else if (type === "RECOMMENDATION" && !links.value.some((l) => (l.role === "RECOMMENDS" || l.role === "EVIDENCE_FOR") && l.toRecord === "$self")) e.push("links: a RECOMMENDATION needs grounding — RECOMMENDS from an insight or EVIDENCE_FOR, to \"$self\"");
  if (e.length) return { ok: false, errors: e };
  return { ok: true, value: { recordType: type, entityKeys: uniq(ents as string[]), resourceIds: uniq(res as string[]), topic: (r.topic as string | null | undefined) ?? null, area: String(r.area), titleHe: r.titleHe as string, body: b as O, confidence: String(r.confidence), reviewAt: (r.reviewAt as string | null | undefined) ?? null, supersedesId: (r.supersedesId as string | null | undefined) ?? null, supersedeReason: (r.supersedeReason as string | null | undefined) ?? null, links: (links as { ok: true; value: O[] }).value } };
}

export function checkTransition(raw: unknown, actor: "SUNNY" | "OWNER"): Check<{ targetKind: string; targetId: string; toStatus: string; reasonHe: string | null }> {
  if (!isObj(raw)) return { ok: false, errors: ["transition: an object"] };
  const e = unknownKeys(raw, ["targetKind", "targetId", "toStatus", "reasonHe"]);
  const kind = String(raw.targetKind), to = String(raw.toStatus);
  if (!(TARGET_KINDS as readonly string[]).includes(kind)) e.push(`targetKind: ${TARGET_KINDS.join(" | ")} (an authorization ends only by the Owner's revoke)`);
  if (!(isStr(raw.targetId) && UUID_RE.test(raw.targetId))) e.push("targetId: uuid");
  if (to === "SUPERSEDED") e.push("toStatus: supersede by creating the successor record (supersedesId)");
  if (actor === "SUNNY" && ["ENDORSED", "REJECTED", "ACCEPTED", "REVOKED"].includes(to)) e.push(`toStatus: ${to} is the Owner's decision — only in Redbloods, never by Sunny`);
  const reason = raw.reasonHe === undefined || raw.reasonHe === null ? null : raw.reasonHe;
  if (reason !== null && !text(reason, 1, 300)) e.push("reasonHe: 1–300 characters");
  if ((REASON_REQUIRED as readonly string[]).includes(to) && reason === null) e.push(`reasonHe: required for ${to}`);
  return e.length ? { ok: false, errors: e } : { ok: true, value: { targetKind: kind, targetId: raw.targetId as string, toStatus: to, reasonHe: reason as string | null } };
}

export interface ContentInput { platform: string; contentKind: string; parentId: string; identityKey: string; canonicalUrl: string | null; displayName: string | null }
export function checkContent(raw: unknown): Check<ContentInput> {
  if (!isObj(raw)) return { ok: false, errors: ["content: an object"] };
  const e = unknownKeys(raw, ["platform", "contentKind", "parentId", "identityKey", "canonicalUrl", "displayName"]);
  if (!(BRAIN_PLATFORMS as readonly string[]).includes(String(raw.platform)) || raw.platform === "web") e.push("platform: instagram | youtube | tiktok | spotify | facebook | x (web pages are registered by the Owner's approval)");
  if (!(CONTENT_KINDS as readonly string[]).includes(String(raw.contentKind))) e.push(`contentKind: ${CONTENT_KINDS.join(" | ")}`);
  if (!(isStr(raw.parentId) && UUID_RE.test(raw.parentId))) e.push("parentId: the account resource id (uuid)");
  if (!(isStr(raw.identityKey) && IDENTITY_KEY_RE.test(raw.identityKey) && raw.identityKey.startsWith("content:"))) e.push("identityKey: content:<the platform's content id>");
  let url: string | null = null;
  if (raw.canonicalUrl !== undefined && raw.canonicalUrl !== null) { url = isStr(raw.canonicalUrl) ? canonicalUrl(raw.canonicalUrl) : null; if (!url) e.push("canonicalUrl: a public https URL"); }
  if (raw.displayName !== undefined && raw.displayName !== null && !text(raw.displayName, 1, 120)) e.push("displayName: 1–120 characters");
  return e.length ? { ok: false, errors: e } : { ok: true, value: { platform: String(raw.platform), contentKind: String(raw.contentKind), parentId: raw.parentId as string, identityKey: raw.identityKey as string, canonicalUrl: url, displayName: (raw.displayName as string | null | undefined) ?? null } };
}
