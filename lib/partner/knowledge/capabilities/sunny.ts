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
import { activeKnowledge, type OwnerKnowledgeRecord } from "../../owner-knowledge/store";
import type { GatewayEntityType } from "../../gateway/types";
import type { KnowledgeCapability, KnowledgeItem, KnowledgeReadResult, KnowledgeSources } from "../types";
import { byCount, item, ok, partner, partnerRecord, record, result, sfact } from "./common";

const ENTITY_TYPES: readonly GatewayEntityType[] = ["project", "client", "label-artist", "vendor", "dj", "show", "release"];
const NOT_ACTIVE: KnowledgeReadResult = {
  items: [], summary: [], completeness: "UNKNOWN", coverage: [partner("הזיכרון הארגוני של סאני עדיין לא הופעל — אין לפרש זאת כ\"אין ידע\".")],
  missing: [{ fact: "Sunny organizational memory", whyNeeded: "the store is not enabled yet (or could not be read) — nothing here means \"none\"" }],
};

/** Does this record concern the entity? Subject identity (all keys of the same identity) or an entity-valued field. */
const touches = (r: OwnerKnowledgeRecord, key: string) => r.identityKeys.includes(key) || r.subjectKey === key || Object.values(r.value).includes(key);
const knowledgeOf = (src: KnowledgeSources) => ok(src.ownerKnowledge);
const todayOf = (src: KnowledgeSources) => ok(src.state)?.todayIL ?? src.now.toISOString().slice(0, 10);

const toItem = (r: OwnerKnowledgeRecord, active: boolean): KnowledgeItem => {
  const k = knowledgeKind(r.kind);
  return item({
    id: r.id, entity: r.subjectKey.startsWith("company:") ? null : r.subjectKey, label: partnerRecord(r.meaningHe), epistemic: r.epistemic, source: "OWNER_KNOWLEDGE",
    freshness: active ? "LIVE" : "HISTORICAL", relationQuality: k?.relationQuality ? "OWNER_CONFIRMED" : undefined,
    fields: {
      kind: r.kind, kindTitle: k ? partner(k.titleHe) : null, status: active ? "ACTIVE" : r.operation === "WITHDRAW" ? "WITHDRAWN" : "SUPERSEDED_OR_EXPIRED",
      value: r.value, learnedAt: r.createdAt, reviewAt: r.reviewAt, expiresAt: r.expiresAt, via: "SUNNY", notes: (k?.notesHe ?? []).map((n) => partner(n)),
      canonical: false,
    },
  });
};

export const ownerKnowledge: KnowledgeCapability = {
  id: "owner_knowledge", domain: "PARTNER", titleHe: "מה סאני למד ממך",
  descriptionForModel: "Organizational knowledge the Owner explicitly taught Sunny and confirmed (typed kinds: aliases, organizational roles, relationships, project blockers, follow-up expectations, vendor commitments, release priority, Owner-reported payments, process friction, working-policy candidates). Always Owner knowledge — never a database fact: an Owner-reported payment is NOT a Finance record, a frequency is NOT a booking rule, a policy is only a CANDIDATE. ACTIVE = in use; all = including superseded / withdrawn / expired history.",
  examplesHe: ["מה לימדתי אותך?", "מי הדי-ג׳יי של הלייבל?", "מה אתה יודע על קלינטון?", "מה סאני יודע?"],
  modes: { active: { descriptionForModel: "Knowledge in use now" }, all: { descriptionForModel: "Including superseded / withdrawn / expired history" } }, defaultMode: "active",
  params: {
    entity: { kind: "entityKey", types: ENTITY_TYPES, descriptionForModel: "Only knowledge about this entity (every key of the same identity counts, and knowledge that points at it)" },
    kind: { kind: "enum", values: KNOWLEDGE_KINDS.map((k) => k.kind), descriptionForModel: "Only this knowledge kind" },
  },
  entityScope: { types: ENTITY_TYPES, param: "entity", mode: "active", limit: 10 },
  paging: { defaultLimit: 20, maxLimit: 50 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["OWNER_KNOWLEDGE", "STATE"],
  read(src, q) {
    const all = knowledgeOf(src);
    if (!all) return NOT_ACTIVE;
    const active = new Set(activeKnowledge(all, todayOf(src)).map((r) => r.id));
    const list = all.filter((r) => (q.mode === "all" || active.has(r.id)) && (!q.params.entity || touches(r, q.params.entity)) && (!q.params.kind || r.kind === q.params.kind))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return result(list.map((r) => toItem(r, active.has(r.id))), { summary: [sfact("BY_KIND", "ידע לפי סוג", byCount(list.map((r) => r.kind)), "OWNER_DECISION", "OWNER_KNOWLEDGE")] });
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
  params: { entity: { kind: "entityKey", types: ENTITY_TYPES, descriptionForModel: "The entity (required)" } },
  entityScope: { types: ENTITY_TYPES, param: "entity", mode: "entity", limit: 10 },
  paging: { defaultLimit: 20, maxLimit: 40 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["STATE", "OWNER_KNOWLEDGE"],
  read(src, q) {
    const key = q.params.entity;
    if (!key) return result([], { completeness: "UNKNOWN", missing: [{ fact: "entity", whyNeeded: "relations are listed per entity — pass params.entity" }] });
    const items: KnowledgeItem[] = [];
    const ct = src.identities.cleantone;
    const st = ok(src.state);
    if (ct && st) {
      const artist = st.domains.labelArtists.data?.items.find((a) => a.name === ct.labelArtistName);
      const keys = [`client:${ct.clientId}`, `dj:${ct.clientId}`, ...(artist ? [`label-artist:${artist.id}`] : [])];
      if (keys.includes(key)) for (const other of keys.filter((k) => k !== key)) {
        items.push(item({ id: `canonical:${other}`, entity: other, label: partner("אותה ישות (קישור קנוני באפליקציה)"), epistemic: "FACT", source: "APP_IDENTITY", relationQuality: "ID", fields: { relation: "SAME_IDENTITY", relationQuality: "CANONICAL_RELATION" } }));
      }
    }
    const kn = knowledgeOf(src);
    if (kn) {
      for (const r of activeKnowledge(kn, todayOf(src)).filter((x) => knowledgeKind(x.kind)?.relationQuality && touches(x, key))) {
        const other = r.identityKeys.includes(key) ? (typeof r.value.object === "string" ? r.value.object : null) : r.subjectKey;
        items.push(item({ id: `owner:${r.id}`, entity: other && !other.startsWith("company:") ? other : null, label: partnerRecord(r.meaningHe), epistemic: r.epistemic, source: "OWNER_KNOWLEDGE", relationQuality: "OWNER_CONFIRMED",
          fields: { relation: r.kind === "ORGANIZATIONAL_ROLE" ? `ROLE:${r.value.role}` : String(r.value.relation ?? r.kind), frequency: r.value.frequency ?? null, relationQuality: "OWNER_CONFIRMED_RELATION", counterpart: other ? record(String(r.value.objectLabel ?? other)) : null } }));
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
