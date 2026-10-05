/**
 * Sunny knowledge capabilities — what the Owner taught Sunny (organizational memory), the cross-entity relation graph
 * with explicit relation quality, and improvement intelligence. Pure readers, READ-ONLY.
 *
 * owner_knowledge reads partner_owner_knowledge ONLY through the OWNER_KNOWLEDGE source (bound when
 * PARTNER_OWNER_KNOWLEDGE_ENABLED; otherwise "not active yet" — never "none"). Owner knowledge is always
 * OWNER_DECISION / OWNER_REPORTED / OWNER_POLICY_CANDIDATE — never a FACT, never canonical state.
 * improvement_signals are ANALYSIS outputs only: Sunny never edits application code or changes a process by itself.
 */
import { knowledgeKind, KNOWLEDGE_KINDS } from "../../owner-knowledge/kinds";
import { activeKnowledge, knowledgeTemporal, type KnowledgeTemporal, type OwnerKnowledgeRecord } from "../../owner-knowledge/store";
import { provenanceOf } from "../../owner-knowledge/provenance";
import { BUSINESS_AREAS, CLASSIFICATION_TYPES, RELATION_TYPES, SOURCE_TYPES } from "../../owner-knowledge/taxonomy";
import { parseEntityKey } from "../../gateway/keys";
import type { GatewayEntityType } from "../../gateway/types";
import type { KnowledgeCapability, KnowledgeItem, KnowledgeReadResult, KnowledgeSources } from "../types";
import { byCount, item, ok, partner, partnerRecord, record, result, sfact, unavailable } from "./common";
import { buildMentionIndex, findMentions, isWeakName, mentionsEntity } from "../inbox-mentions";
import { normalizeName } from "../../gateway/resolve";
import { activeLinksOf, headOf, type InboxMemory } from "../../../inbox-memory";
import { understandUpdates } from "../inbox-understand";
import { decideInboxLifecycle, inboxExecutiveSummary } from "../../sunny/inbox-lifecycle";
import { inboxLifecycleBaseOf } from "../../sunny/inbox-lifecycle-base";

const ENTITY_TYPES: readonly GatewayEntityType[] = ["project", "client", "label-artist", "vendor", "dj", "show", "release"];
const NOT_ACTIVE: KnowledgeReadResult = {
  items: [], summary: [], completeness: "UNKNOWN", coverage: [partner("הזיכרון הארגוני של סאני עדיין לא הופעל — אין לפרש זאת כ\"אין ידע\".")],
  missing: [{ fact: "Sunny organizational memory", whyNeeded: "the store is not enabled yet (or could not be read) — nothing here means \"none\"" }],
};

/** Does this record concern the entity? Subject identity (all keys of the same identity) or an entity-valued field. */
const touches = (r: OwnerKnowledgeRecord, key: string) => r.identityKeys.includes(key) || r.subjectKey === key || Object.values(r.value).includes(key);
const knowledgeOf = (src: KnowledgeSources) => ok(src.ownerKnowledge);
const todayOf = (src: KnowledgeSources) => ok(src.state)?.todayIL ?? src.now.toISOString().slice(0, 10);

/** A Gateway-addressable key, or null (a `known:` identity / the company are not Gateway entities). */
const gatewayKey = (k: string | null | undefined): string | null => (k && (parseEntityKey(k) ? k : null)) ?? null;

/** What a stored row reads as: an INFERRED item is a HYPOTHESIS, never an Owner decision / fact. */
const epistemicOf = (r: OwnerKnowledgeRecord) => (r.value.sourceType === "INFERRED" ? ("HYPOTHESIS" as const) : r.epistemic);

const provenanceFields = (r: OwnerKnowledgeRecord) => {
  const p = provenanceOf(r.value);
  return { sourceType: p.sourceType, confidence: p.confidence, sourceRef: p.sourceRef, observedAt: p.observedAt, stated: p.explicit };
};

const toItem = (r: OwnerKnowledgeRecord, active: boolean, temporal: KnowledgeTemporal): KnowledgeItem => {
  const k = knowledgeKind(r.kind);
  const prov = provenanceFields(r);
  return item({
    id: r.id, entity: r.subjectKey.startsWith("company:") ? null : gatewayKey(r.servedSubjectKey ?? r.subjectKey), label: partnerRecord(r.meaningHe), epistemic: epistemicOf(r), source: "OWNER_KNOWLEDGE",
    freshness: active ? "LIVE" : "HISTORICAL", relationQuality: k?.relationQuality ? (prov.sourceType === "INFERRED" ? "DERIVED" : "OWNER_CONFIRMED") : undefined,
    fields: {
      kind: r.kind, kindTitle: k ? partner(k.titleHe) : null, status: active ? "ACTIVE" : r.operation === "WITHDRAW" ? "WITHDRAWN" : "SUPERSEDED_OR_EXPIRED",
      temporal, validity: { status: r.value.status ?? "ACTIVE", validFrom: r.value.validFrom ?? null, validUntil: r.value.validUntil ?? null },
      provenance: prov, subjectKey: r.subjectKey,
      value: r.value, learnedAt: r.createdAt, reviewAt: r.reviewAt, expiresAt: r.expiresAt, via: "SUNNY", notes: (k?.notesHe ?? []).map((n) => partner(n)),
      canonical: false,
    },
  });
};

export const ownerKnowledge: KnowledgeCapability = {
  id: "owner_knowledge", domain: "PARTNER", titleHe: "מה סאני למד ממך",
  descriptionForModel: "Organizational knowledge the Owner taught Sunny and confirmed: aliases, roles, ENTITY_RELATIONSHIP (OWNER_OF / LABEL_ARTIST_OF / WORKS_WITH … with ACTIVE / ENDED / HISTORICAL status + validity), ENTITY_CLASSIFICATION, KNOWN_ENTITY, blockers, follow-ups, commitments, priorities, Owner-reported payments, frictions, policies, BUSINESS_DECISION (what the Owner decided, why, when to revisit) and BUSINESS_LEARNING (Owner-confirmed only). Always Owner knowledge, never a database fact (WORKS_WITH is NOT a label artist; a policy is only a candidate). Each item has provenance (sourceType, confidence) and a temporal state: CURRENT, HISTORICAL (ended, kept), FUTURE, SUPERSEDED, WITHDRAWN. active = CURRENT only (relation=LABEL_ARTIST_OF → the current roster); historical = ended facts (who WAS on it); all = everything. INFERRED = a HYPOTHESIS.",
  examplesHe: ["מה לימדתי אותך?", "מי הבעלים של Redbloods?", "מי נמצא כרגע בסגל?", "מי היה בעבר בסגל?", "מה סאני יודע?"],
  modes: { active: { descriptionForModel: "Knowledge in use now (CURRENT only)" }, historical: { descriptionForModel: "Ended / past-validity knowledge — kept as history" }, all: { descriptionForModel: "Everything: current, historical, superseded, withdrawn, expired" } }, defaultMode: "active",
  params: {
    entity: { kind: "entityKey", types: ENTITY_TYPES, descriptionForModel: "Only knowledge about this entity (every key of the same identity counts, and knowledge that points at it)" },
    known: { kind: "text", maxLength: 63, descriptionForModel: "Only knowledge about a declared KNOWN_ENTITY, by its slug (e.g. nagashbeatz)" },
    kind: { kind: "enum", values: KNOWLEDGE_KINDS.map((k) => k.kind), descriptionForModel: "Only this knowledge kind" },
    relation: { kind: "enum", values: RELATION_TYPES, descriptionForModel: "Only this relationship type (ENTITY_RELATIONSHIP)" },
    area: { kind: "enum", values: BUSINESS_AREAS, descriptionForModel: "Only policies / frictions of this business area" },
    classification: { kind: "enum", values: CLASSIFICATION_TYPES, descriptionForModel: "Only this classification type (ENTITY_CLASSIFICATION)" },
  },
  entityScope: { types: ENTITY_TYPES, param: "entity", mode: "active", limit: 10 },
  paging: { defaultLimit: 20, maxLimit: 50 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["OWNER_KNOWLEDGE", "STATE"],
  read(src, q) {
    const all = knowledgeOf(src);
    if (!all) return NOT_ACTIVE;
    const today = todayOf(src);
    const active = new Set(activeKnowledge(all, today).map((r) => r.id));
    const temporal = knowledgeTemporal(all, today);
    const knownKey = q.params.known ? `known:${q.params.known.toLowerCase()}` : null;
    const inMode = (r: OwnerKnowledgeRecord) => q.mode === "all" || (q.mode === "historical" ? temporal.get(r.id) === "HISTORICAL" : active.has(r.id));
    const list = all.filter((r) => inMode(r) && (!q.params.entity || touches(r, q.params.entity)) && (!knownKey || touches(r, knownKey)) && (!q.params.kind || r.kind === q.params.kind)
      && (!q.params.relation || r.value.relation === q.params.relation) && (!q.params.area || r.value.area === q.params.area) && (!q.params.classification || r.value.classificationType === q.params.classification))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return result(list.map((r) => toItem(r, active.has(r.id), temporal.get(r.id) ?? "CURRENT")), {
      summary: [sfact("BY_KIND", "ידע לפי סוג", byCount(list.map((r) => r.kind)), "OWNER_DECISION", "OWNER_KNOWLEDGE"), sfact("BY_TEMPORAL", "ידע לפי מצב בזמן", byCount(list.map((r) => temporal.get(r.id) ?? "CURRENT")), "OWNER_DECISION", "OWNER_KNOWLEDGE")],
    });
  },
};

/**
 * The cross-entity graph for one entity, every edge with its quality:
 *   CANONICAL_RELATION       — an id link in the app (e.g. DJ CLEANTONE's client + label-artist records)
 *   OWNER_CONFIRMED_RELATION — the Owner told Sunny and confirmed it (owner_knowledge)
 *   TEXT_MATCH / DERIVED     — reported by the entity-specific capabilities (shows, releases …) with their own quality
 * Sunny never manufactures a canonical DB relation from knowledge or text.
 */
export const relations: KnowledgeCapability = {
  id: "relations", domain: "COMPANY", titleHe: "קשרים בין ישויות",
  descriptionForModel: "How one entity is connected to others, each edge labelled with its relation quality: CANONICAL_RELATION (an id link in the app), OWNER_CONFIRMED_RELATION (the Owner told Sunny and confirmed). Text matches and derived links are reported by the entity's own capabilities (shows, releases…) with their own quality. A relation here never implies a canonical database link.",
  examplesHe: ["עם מי קלינטון קשור?", "מי עובד עם שליו?"],
  modes: { entity: { descriptionForModel: "All known edges of one entity" } }, defaultMode: "entity",
  params: {
    entity: { kind: "entityKey", types: ENTITY_TYPES, descriptionForModel: "The entity (pass this OR known)" },
    known: { kind: "text", maxLength: 63, descriptionForModel: "A declared KNOWN_ENTITY by its slug (e.g. nagashbeatz) — for an entity with no canonical Redbloods record" },
  },
  entityScope: { types: ENTITY_TYPES, param: "entity", mode: "entity", limit: 10 },
  paging: { defaultLimit: 20, maxLimit: 40 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["STATE", "OWNER_KNOWLEDGE"],
  read(src, q) {
    const key = q.params.entity ?? (q.params.known ? `known:${q.params.known.toLowerCase()}` : undefined);
    if (!key) return result([], { completeness: "UNKNOWN", missing: [{ fact: "entity", whyNeeded: "relations are listed per entity — pass params.entity or params.known" }] });
    const items: KnowledgeItem[] = [];
    const ct = src.identities.cleantone;
    const st = ok(src.state);
    if (ct && st) {
      // the label DJ (team): his client + DJ keys, plus the retired label-artist key older Owner knowledge carries
      const keys = [`client:${ct.clientId}`, `dj:${ct.clientId}`];
      // a retired key is only matched (older Owner knowledge / links), never served as a live "same identity" entity
      if (keys.includes(key) || ct.retiredKeys.includes(key)) for (const other of keys.filter((k) => k !== key)) {
        items.push(item({ id: `canonical:${other}`, entity: other, label: partner("אותה ישות (קישור קנוני באפליקציה)"), epistemic: "FACT", source: "APP_IDENTITY", relationQuality: "ID", fields: { relation: "SAME_IDENTITY", relationQuality: "CANONICAL_RELATION" } }));
      }
    }
    const kn = knowledgeOf(src);
    if (kn) {
      const today = todayOf(src);
      const temporal = knowledgeTemporal(kn, today);
      // every terminal ASSERT relationship edge: CURRENT ones are live, ended / past ones are kept as HISTORICAL edges
      const edgeRows = kn.filter((x) => knowledgeKind(x.kind)?.relationQuality && touches(x, key) && (temporal.get(x.id) === "CURRENT" || temporal.get(x.id) === "HISTORICAL" || temporal.get(x.id) === "FUTURE"));
      for (const r of edgeRows) {
        const prov = provenanceFields(r);
        const other = r.identityKeys.includes(key) ? (typeof r.value.object === "string" ? r.value.object : null) : (r.servedSubjectKey ?? r.subjectKey);
        const t = temporal.get(r.id) ?? "CURRENT";
        items.push(item({ id: `owner:${r.id}`, entity: other && !other.startsWith("company:") ? gatewayKey(other) : null, label: partnerRecord(r.meaningHe), epistemic: epistemicOf(r), source: "OWNER_KNOWLEDGE", freshness: t === "CURRENT" ? "LIVE" : "HISTORICAL",
          relationQuality: prov.sourceType === "INFERRED" ? "DERIVED" : "OWNER_CONFIRMED",
          fields: { relation: r.kind === "ORGANIZATIONAL_ROLE" ? `ROLE:${r.value.role}` : String(r.value.relation ?? r.kind), frequency: r.value.frequency ?? null, relationQuality: prov.sourceType === "INFERRED" ? "DERIVED_RELATION" : "OWNER_CONFIRMED_RELATION",
            temporal: t, validity: { status: r.value.status ?? "ACTIVE", validFrom: r.value.validFrom ?? null, validUntil: r.value.validUntil ?? null }, provenance: prov,
            counterpartKey: other, counterpart: other ? record(String(r.value.objectLabel ?? other)) : null } }));
      }
    }
    return result(items, {
      completeness: st && kn ? "COMPLETE" : "PARTIAL",
      coverage: [partner("קשרי טקסט (TEXT_MATCH) ונגזרים מופיעים ביכולות של הישות עצמה (הופעות, ריליסים…) עם איכות הקשר שלהם."), ...(kn ? [] : [partner("הזיכרון הארגוני של סאני עדיין לא פעיל — קשרים שאישרת לא נכללו.")])],
    });
  },
};

/**
 * Improvement intelligence — analysis only. Four classes:
 *   BUSINESS_KNOWLEDGE      — the Owner confirmed knowledge Sunny now applies (owner_knowledge)
 *   PROCESS_FRICTION        — Owner-reported friction + Memory pattern candidates (never rules)
 *   SYSTEM_GAP              — company data Sunny cannot trust / see (integrity unknowns, finance coverage, known blind spots)
 *   PRODUCT_IMPROVEMENT_IDEA — what the Redbloods OS could capture so the gap closes (a suggestion for the Owner)
 */
export const improvementSignals: KnowledgeCapability = {
  id: "improvement_signals", domain: "COMPANY", titleHe: "מה אפשר לשפר",
  descriptionForModel: "Improvement intelligence (analysis only — nothing is changed automatically, Sunny never edits code): BUSINESS_KNOWLEDGE Sunny learned, PROCESS_FRICTION (Owner-reported friction, pattern candidates), SYSTEM_GAP (data Sunny cannot see or trust), PRODUCT_IMPROVEMENT_IDEA (what Redbloods OS could capture to close a gap). Suggestions for the Owner to decide on.",
  examplesHe: ["מה אפשר לשפר?", "איפה המערכת חסרה?", "מה חוזר על עצמו?"],
  modes: { current: { descriptionForModel: "All current signals" } }, defaultMode: "current",
  params: { signal: { kind: "enum", values: ["BUSINESS_KNOWLEDGE", "PROCESS_FRICTION", "SYSTEM_GAP", "PRODUCT_IMPROVEMENT_IDEA"], descriptionForModel: "Only this class" } },
  paging: { defaultLimit: 20, maxLimit: 40 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["INTEGRITY", "FINANCE", "MEMORY", "OWNER_KNOWLEDGE", "STATE"],
  read(src, q) {
    const out: KnowledgeItem[] = [];
    const push = (signal: string, id: string, labelHe: string, epistemic: KnowledgeItem["epistemic"], source: KnowledgeItem["source"], fields: Record<string, unknown> = {}, recordText = false) =>
      out.push(item({ id: `${signal}:${id}`, label: recordText ? partnerRecord(labelHe) : partner(labelHe), epistemic, source, fields: { signal, analysisOnly: true, ...fields } }));
    const kn = knowledgeOf(src);
    if (kn) for (const r of activeKnowledge(kn, todayOf(src))) {
      if (r.kind === "PROCESS_FRICTION") push("PROCESS_FRICTION", r.id, r.meaningHe, "OWNER_REPORTED", "OWNER_KNOWLEDGE", { area: r.value.area }, true);
      else push("BUSINESS_KNOWLEDGE", r.id, r.meaningHe, r.epistemic, "OWNER_KNOWLEDGE", { kind: r.kind }, true);
    }
    for (const p of ok(src.memory)?.patternCandidates ?? []) push("PROCESS_FRICTION", `${p.signature.entityFamily}|${p.signature.issueType}`, p.noteHe, "PATTERN_CANDIDATE", "MEMORY", { instances: p.instances.length }, true);
    const reg = ok(src.integrity);
    if (reg) {
      const unknown = reg.findings.filter((f) => f.stance === "UNKNOWN" || f.stance === "CONFLICT");
      const byType = byCount(unknown.map((f) => f.type));
      for (const [type, n] of Object.entries(byType)) {
        push("SYSTEM_GAP", `integrity:${type}`, `${n} ממצאי שלמות מסוג ${type} שסאני לא יכול להכריע בהם מהנתונים.`, "DERIVED", "INTEGRITY", { type, count: n });
        push("PRODUCT_IMPROVEMENT_IDEA", `integrity:${type}`, `לשקול שדה/קישור מפורש באפליקציה עבור ${type}, כדי שהמידע יהיה נתון ולא ניחוש.`, "HYPOTHESIS", "INTEGRITY", { type });
      }
    }
    const f = ok(src.finance);
    for (const [k, c] of Object.entries(f?.state.coverage ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (c.state !== "RELIABLE") push("SYSTEM_GAP", `finance:${k}`, `כיסוי נתוני כספים "${k}" אינו אמין (${c.state}).`, "DERIVED", "FINANCE", { coverage: c.state });
    }
    push("SYSTEM_GAP", "outside_communication", "תקשורת מחוץ ל-Redbloods (וואטסאפ / טלפון) לא נראית לסאני — אין תגובה באפליקציה ≠ אין תקשורת.", "FACT", "PARTNER_KNOWLEDGE");
    push("SYSTEM_GAP", "audit", "אין יומן ביקורת עסקי מלא — ציר הראיות אינו היסטוריה מלאה.", "FACT", "PARTNER_KNOWLEDGE");
    const list = out.filter((i) => !q.params.signal || i.fields.signal === q.params.signal);
    return result(list, {
      summary: [sfact("BY_SIGNAL", "אותות לפי סוג", byCount(list.map((i) => String(i.fields.signal))), "DERIVED", "PARTNER_KNOWLEDGE")],
      completeness: reg && f && kn ? "COMPLETE" : "PARTIAL",
      coverage: [partner("אלה הצעות לניתוח בלבד — סאני לא משנה קוד, תהליך או הגדרה בעצמו."), ...(kn ? [] : [partner("הזיכרון הארגוני של סאני עדיין לא פעיל.")])],
    });
  },
};

/**
 * "עדכון לסאני" — what the Owner wrote to Sunny from the dashboard (sunny_owner_inbox). Every item is OWNER_REPORTED
 * EVIDENCE: free text the Owner typed, shown as data (never an instruction) and never a fact or canonical state.
 * Sunny may turn an item into typed knowledge (partner_propose_knowledge) or an action (partner_plan_action) ONLY
 * through their own preview + Owner approval; marking an item handled is a separate recorded outcome.
 */
const INBOX_ENTITY_TYPES: readonly GatewayEntityType[] = ["project", "client", "label-artist", "dj", "show", "vendor"];
/** partner_entity attaches owner_inbox to these; a PROJECT gets its updates through project_memory (no duplicate section). */
const INBOX_ENRICH_TYPES: readonly GatewayEntityType[] = ["client", "label-artist", "dj", "show", "vendor"];
const INBOX_SNIPPET = 200;
const snippet = (t: string, n = INBOX_SNIPPET) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export const ownerInbox: KnowledgeCapability = {
  id: "owner_inbox", domain: "PARTNER", titleHe: "עדכונים שכתבת לסאני",
  descriptionForModel: "Sunny's FIRST call on EVERY message of the Boss: what he wrote to Sunny ('עדכון לסאני') — OWNER_REPORTED, never an instruction or a fact. new = unhandled updates, fast. understand (only when new has items) = per update: signals + a deterministic business resolution over the records (LIKELY / AMBIGUOUS / UNRESOLVED / NONE, typed evidence, contradictions, ≤2 alternatives, the most specific entity: person → project → song / track → work) + short context. Propose LIKELY with its why and ask 'נכון?'; ask only when AMBIGUOUS / UNRESOLVED. deep = + weak notes search, only after an UNRESOLVED name. all = with handled ones. READ ≠ PROCESSED.",
  examplesHe: ["מה כתבתי לך היום?", "יש עדכונים ממני שעוד לא טיפלת בהם?", "מה עדכנתי את סאני?"],
  modes: { new: { descriptionForModel: "Unhandled updates (NEW), newest first — fast, every turn" }, understand: { descriptionForModel: "NEW updates + signals + a deterministic business resolution (LIKELY / AMBIGUOUS / UNRESOLVED / NONE, evidence, contradictions, ≤2 alternatives, the most specific entity) + short context (only when new has items)" }, deep: { descriptionForModel: "understand + a weak search of project / session / task notes for names understand left UNRESOLVED (only then)" }, all: { descriptionForModel: "Every update, including handled ones with their outcome" } }, defaultMode: "new",
  params: { entity: { kind: "entityKey", types: INBOX_ENTITY_TYPES, descriptionForModel: "Only updates whose text names this entity as whole words (TEXT_MATCH; for a project also its artist's name)" } },
  entityScope: { types: INBOX_ENRICH_TYPES, param: "entity", mode: "new", limit: 3 },
  paging: { defaultLimit: 20, maxLimit: 50 }, recordTextLimit: 1000,
  access: { externalRead: true, ownerOnly: true, sensitivity: "PERSONAL" }, needs: ["OWNER_INBOX"], modeNeeds: { understand: ["STATE", "OPERATIONS", "OWNER_KNOWLEDGE"], deep: ["STATE", "OPERATIONS", "OWNER_KNOWLEDGE", "PROJECT_DETAIL"] },
  read(src, q) {
    const all = ok(src.ownerInbox);
    if (!all) return unavailable("עדכונים לסאני");
    if (q.mode === "understand" || q.mode === "deep") {
      const fresh = all.filter((i) => i.status === "NEW").sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
      const u = new Map(understandUpdates(src, fresh, q.mode === "deep").map((x) => [x.itemId, x]));
      const stateRead = !!ok(src.state);
      // One Brain (2026-10-05): every update's derived lifecycle — what happened since, its home, its display state.
      // The Action Layer history is added by the connector (same decideInboxLifecycle); here actions are "not read".
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(src.now);
      const life = new Map(fresh.map((i) => [i.id, decideInboxLifecycle(inboxLifecycleBaseOf(src, i, u.get(i.id) ?? null, today))]));
      const exec = inboxExecutiveSummary([...life.values()]);
      return result(fresh.map((i) => item({
        id: i.id, entity: null, label: record(i.body), epistemic: "OWNER_REPORTED", source: "OWNER_INBOX", freshness: "LIVE",
        fields: {
          writtenAt: i.createdAt, status: i.status, canonical: false,
          signals: u.get(i.id)?.signals ?? null, resolution: u.get(i.id)?.resolution ?? null, context: u.get(i.id)?.context ?? null,
          lifecycle: life.get(i.id) ?? null,
          howToThinkHe: partner("אל תקריא. LIKELY = הצע את ההנחה + למה (הראיות) + 'נכון?'. AMBIGUOUS = שאל עם האפשרויות והראיות. UNRESOLVED = אמור מה חיפשת ושאל מי זה (או נסה mode deep). NONE = אל תנחש. recordVsReport = 'אמרת … — ברשומה …'. הסקה ≠ עובדה עד שהבוס מאשר."),
        },
      })), {
        summary: [sfact("NEW_COUNT", "עדכונים שלא טופלו", fresh.length, "OWNER_REPORTED", "OWNER_INBOX"),
          sfact("EXECUTIVE", "תמונת העדכונים (נגזר, לא נשמר)", { ...exec, howHe: "ZERO INBOX: פתק יוצא מהתיבה כשלמידע שלו יש בית (הבנה / ידע / פעולה שבוצעה על אותה רשומה אחרי הפתק) — העבודה עצמה ממשיכה ברשומות. גיל לבד לא סוגר כלום; טכני נסגר רק כשהבוס אומר שזה עובד; סגירה רק באישור על הרשימה המדויקת." }, "DERIVED", "OWNER_INBOX")],
        completeness: stateRead ? "COMPLETE" : "PARTIAL",
        coverage: stateRead ? [] : [partner("מצב החברה לא נקרא — אין שמות / הקשר לעדכונים; הטקסטים עצמם כן נקראו.")],
      });
    }
    // the preflight read (no entity) stays fast: no company state, no mentions. Mentions (TEXT_MATCH) are computed only
    // for partner_entity, where the company state is already loaded; names come ONLY from partner_resolve's index.
    const entity = q.params.entity ?? null;
    const index = entity && ok(src.state) ? buildMentionIndex(src) : null;
    if (entity && !index) return { ...unavailable("שמות הישויות — עדכונים שמזכירים ישות נטענים דרך partner_entity"), items: [] };
    const mem = ok(src.inboxMemory) as InboxMemory | null;
    const linkedTo = new Map(entity && mem ? activeLinksOf(mem.links, (l) => l.entityKey === entity).map((l) => [l.itemId, l.quality] as const) : []);
    const memoryOf = (id: string) => mem ? {
      links: activeLinksOf(mem.links, (l) => l.itemId === id).map((l) => ({ linkId: l.id, entity: l.entityKey, quality: l.quality })),
      interpretations: mem.interpretations.filter((x) => x.itemId === id && !x.retractedAt).map((x) => ({ interpretationId: x.id, project: x.entityKey, head: headOf(mem.interpretations, x.entityKey)?.id === x.id })),
    } : null;
    const artistNorm = entity?.startsWith("project:") ? normalizeName(ok(src.state)?.domains.projects.data?.index[entity.slice(8)]?.artistText ?? "") : "";
    const list = all
      .filter((i) => q.mode === "all" || i.status === "NEW")
      .map((i) => ({ i, mentions: index ? findMentions(i.body, index) : null }))
      .map((x) => ({ ...x, via: !entity ? null : linkedTo.has(x.i.id) ? "LINK" : !x.mentions ? null : mentionsEntity(x.mentions, entity) ? "ENTITY_NAME" : artistNorm && !isWeakName(artistNorm) && x.mentions.some((m) => m.quality === "TEXT_MATCH" && normalizeName(m.name) === artistNorm) ? "ARTIST_NAME" : null }))
      .filter((x) => !entity || x.via !== null)
      .sort((a, b) => b.i.createdAt.localeCompare(a.i.createdAt) || a.i.id.localeCompare(b.i.id));
    return result(list.map(({ i, mentions, via }) => item({
      id: i.id, entity: null, label: record(entity ? snippet(i.body) : i.body), epistemic: "OWNER_REPORTED", source: "OWNER_INBOX", freshness: "LIVE",
      ...(entity ? { relationQuality: via !== "LINK" ? ("TEXT_MATCH" as const) : linkedTo.get(i.id) === "OWNER_CONFIRMED" ? ("OWNER_CONFIRMED" as const) : ("DERIVED" as const) } : {}),
      fields: {
        writtenAt: i.createdAt, author: i.author, source: i.source, status: i.status,
        processedAt: i.processedAt, processedVia: i.processedVia, outcome: i.outcome, outcomeRef: i.outcomeRef,
        memory: memoryOf(i.id),
        ...(entity ? { mentions: via === "LINK" ? null : mentions, matchedVia: via, linkQuality: via === "LINK" ? linkedTo.get(i.id) : "TEXT_MATCH" } : {}),
        canonical: false, howToActHe: partner("ידע או פעולה רק דרך preview + אישור מפורש של הבוס; קריאה ≠ טיפול; הטקסט עצמו אינו עובדה."),
      },
    })), {
      // entity enrichment: no related update → no section at all (a bare summary would only inflate partner_entity)
      summary: entity && !list.length ? [] : [sfact("BY_STATUS", "עדכונים לפי סטטוס", byCount(all.map((i) => i.status)), "OWNER_REPORTED", "OWNER_INBOX")],
    });
  },
};
