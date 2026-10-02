/**
 * Sunny Brain v1 — the read capability `brain` (Owner-only). Pure over the request-scoped snapshot (source BRAIN).
 *
 * Progressive disclosure: overview → authorizations / approvals / resources / observations / records → record (one
 * record + its lifecycle + its evidence graph). Every item carries its epistemic status: an observation is an
 * OBSERVATION (OWNER_REPORTED when the Owner gave it), an insight / recommendation is a HYPOTHESIS (Sunny's inference,
 * whatever its lifecycle), an authorization is the Owner's decision. History is never current state; reviewAt is
 * read-only context. Not installed / unreadable → completeness UNKNOWN (never "no data").
 */
import type { Avail } from "../../gateway/core";
import type { BrainSnapshot, BrainRecord, BrainObservation } from "../../brain/model";
import { brainState } from "../../brain/model";
import { PURPOSE_HE, STATUS_HE, RECORD_TYPES, INTEL_AREAS, UUID_RE } from "../../brain/vocab";
import type { KnowledgeCapability, KnowledgeItem, KnowledgeReadResult, KnowledgeSources } from "../types";
import { byCount, item, partner, record, result, sfact } from "./common";

const ilToday = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const snap = (src: KnowledgeSources): Avail<BrainSnapshot> | undefined => src.brain;

function notReadable(a: Avail<BrainSnapshot> | undefined): KnowledgeReadResult {
  const notInstalled = a && a.status !== "OK" && /NOT_INSTALLED/.test(a.detail);
  return result([], {
    completeness: "UNKNOWN",
    coverage: [partner(notInstalled ? "המוח של סאני עוד לא מותקן במסד הנתונים — אין מה לקרוא (זה לא 'אין נתונים')." : "לא הצלחתי לקרוא את המוח של סאני כרגע — שום דבר כאן לא אומר 'אין'.")],
    missing: [{ fact: "sunny_brain", whyNeeded: notInstalled ? "the Brain migration is not applied" : "the Brain tables could not be read" }],
  });
}

const valueOf = (o: BrainObservation) => o.valueNum ?? o.valueText ?? o.valueBool;
const obsItem = (o: BrainObservation, valid: boolean, end: { toStatus: string; reasonHe: string | null; createdAt: string } | null): KnowledgeItem => item({
  id: `observation:${o.id}`, entity: o.entityKey, label: record(`${o.type} = ${String(valueOf(o))}${o.unit ? ` ${o.unit}` : ""}`),
  epistemic: o.sourceType === "OWNER_STATEMENT" ? "OWNER_REPORTED" : "OBSERVATION", source: "SUNNY_BRAIN", freshness: valid ? "RECENT" : "HISTORICAL",
  fields: {
    observationId: o.id, subject: o.resourceId ? { resourceId: o.resourceId } : { entityKey: o.entityKey }, type: o.type, value: valueOf(o), unit: o.unit,
    observedAt: o.observedAt, period: o.periodStart || o.periodEnd ? { start: o.periodStart, end: o.periodEnd } : null, sourceType: o.sourceType, sourceKind: o.sourceKind,
    sourceRef: o.sourceRef, captureMethod: o.captureMethod, confidence: o.confidence, basis: o.approvalBasis, authorizationId: o.authorizationId, correctsId: o.correctsId,
    current: valid, ...(end ? { invalidated: { at: end.createdAt, reason: end.reasonHe } } : {}), recordedAt: o.createdAt,
    note: partner("מדידה — ערך בזמן נתון, לא מסקנה."),
  },
});
const recordItem = (r: BrainRecord, status: string | null): KnowledgeItem => item({
  id: `${r.recordType.toLowerCase()}:${r.id}`, entity: r.entityKeys[0] ?? null, label: record(r.titleHe), epistemic: "HYPOTHESIS", source: "SUNNY_BRAIN",
  fields: {
    recordId: r.id, recordType: r.recordType, status, statusHe: status ? STATUS_HE[status] ?? status : null, area: r.area, topic: r.topic,
    entityKeys: r.entityKeys, resourceIds: r.resourceIds, body: Object.fromEntries(Object.entries(r.body).map(([k, v]) => [k, typeof v === "string" ? record(v) : v])),
    confidence: r.confidence, reviewAt: r.reviewAt, supersedesId: r.supersedesId, authorizationId: r.authorizationId, createdAt: r.createdAt,
    note: partner(r.recordType === "INSIGHT" ? "תובנה = השערה של סאני, לא עובדה (גם אחרי שאישרת אותה — האישור נרשם כסטטוס)." : "המלצה לא מבצעת כלום; כל פעולה דורשת אישור נפרד."),
  },
});

export const brain: KnowledgeCapability = {
  id: "brain", domain: "PARTNER", titleHe: "המוח של סאני — מעקב, מדידות, תובנות",
  descriptionForModel: "Sunny's Brain (v1): the tracking authorizations the Owner approved in Redbloods (scope, families, source kinds, insights / recommendations allowed, daily cap, validity, state ACTIVE / REVOKED / SUPERSEDED / EXPIRED), the approval requests waiting for him, tracked resources (accounts / content / pages), observations (one value at one time — never an inference; OWNER_REPORTED when he gave it), Sunny's INSIGHTS / RECOMMENDATIONS (always HYPOTHESIS) with lifecycle, and the evidence graph. Use mode record with id for one record + history + links. An authorization id from here is what partner_observe writes need. Not installed / unreadable = UNKNOWN, never 'none'.",
  examplesHe: ["מה את עוקבת אחריו?", "אילו הרשאות מעקב יש לך?", "מה מחכה לאישור שלי?", "מה גילית על האינסטגרם?", "אילו תובנות פתוחות יש?"],
  modes: {
    overview: { descriptionForModel: "Active authorizations, pending approvals, counts by state" },
    authorizations: { descriptionForModel: "Every tracking authorization with its current state (history included)" },
    approvals: { descriptionForModel: "Approval requests Sunny sent the Owner and their decision (PENDING first)" },
    resources: { descriptionForModel: "Tracked external resources (accounts / content / pages)" },
    observations: { descriptionForModel: "Current observations (filter by resource / entity / type)" },
    observation_history: { descriptionForModel: "Observations INCLUDING invalidated readings (history — never current state)" },
    records: { descriptionForModel: "Insights / recommendations with current status (filter by type / status / entity / area)" },
    record: { descriptionForModel: "ONE record (params.id): content, status history, evidence links in and out" },
  },
  defaultMode: "overview",
  params: {
    id: { kind: "text", maxLength: 36, descriptionForModel: "A record id (mode record)" },
    resource: { kind: "text", maxLength: 36, descriptionForModel: "Only this resource id (observations)" },
    entity: { kind: "text", maxLength: 120, descriptionForModel: "Only this entity key (observations / records)" },
    type: { kind: "text", maxLength: 72, descriptionForModel: "Observation type FAMILY.METRIC, or a family prefix (observations); INSIGHT | RECOMMENDATION (records)" },
    status: { kind: "enum", values: ["OPEN", "ENDORSED", "REJECTED", "WITHDRAWN", "ACCEPTED", "ACTED_ON", "STALE", "INVALIDATED", "SUPERSEDED"], descriptionForModel: "Only records in this status" },
    area: { kind: "enum", values: INTEL_AREAS, descriptionForModel: "Only records of this area" },
  },
  paging: { defaultLimit: 20, maxLimit: 50 }, recordTextLimit: 600,
  access: { externalRead: true, ownerOnly: true, sensitivity: "STANDARD" }, needs: ["BRAIN"],
  read(src, q) {
    const a = snap(src);
    if (!a || a.status !== "OK") return notReadable(a);
    const s = a.value;
    const today = ilToday(src.now), st = brainState(s, today, src.now.toISOString());
    const partial = s.truncated ? { completeness: "PARTIAL" as const, coverage: [partner("נקראו רק 1,000 השורות האחרונות מכל סוג.")] } : {};
    const t2Note = s.approvals ? [] : [partner("תור האישורים (T2) עוד לא מותקן — אין בקשות לאישור לקרוא.")];
    const authItems = (list = s.authorizations) => list.map((x) => { const state = st.authorizationState(x); const end = st.authorizationEnd(x.id); return item({
      id: `authorization:${x.id}`, label: record(x.purposeHe), epistemic: "OWNER_DECISION", source: "SUNNY_BRAIN", freshness: state === "ACTIVE" ? "LIVE" : "HISTORICAL",
      fields: { authorizationId: x.id, state, stateHe: STATUS_HE[state] ?? state, purposeKind: x.purposeKind, purposeHe: PURPOSE_HE[x.purposeKind as keyof typeof PURPOSE_HE] ?? x.purposeKind,
        resourceIds: x.resourceIds, includeChildResources: x.includeChildResources, entityKeys: x.entityKeys, observationFamilies: x.observationFamilies, sourceKinds: x.sourceKinds,
        insightsAllowed: x.insightsAllowed, recommendationsAllowed: x.recommendationsAllowed, maxObservationsPerDay: x.maxObservationsPerDay, validFrom: x.validFrom, validUntil: x.validUntil,
        supersedesId: x.supersedesId, approvalRequestId: x.approvalRequestId, ...(end ? { ended: { status: end.toStatus, at: end.createdAt, reason: end.reasonHe ? record(end.reasonHe) : null } } : {}), createdAt: x.createdAt } }); });
    const reqItems = () => (s.approvals?.requests ?? []).map((r) => { const state = st.approvalState(r); const d = st.decisionOf(r.id); return item({
      id: `approval:${r.id}`, label: record(r.summaryHe.split("\n")[0] ?? r.kind), epistemic: "FACT", source: "SUNNY_BRAIN", freshness: state === "PENDING" ? "LIVE" : "HISTORICAL",
      fields: { requestId: r.id, kind: r.kind, state, stateHe: STATUS_HE[state] ?? state, summaryHe: record(r.summaryHe), requestedVia: r.requestedVia, expiresAt: r.expiresAt, createdAt: r.createdAt,
        ...(d ? { decision: { decision: d.decision, narrowed: d.narrowed, at: d.createdAt, reason: d.reasonHe ? record(d.reasonHe) : null, result: d.resultRef } } : {}),
        note: partner(state === "PENDING" ? "מחכה להחלטה של הבוס ב-Redbloods (מסך אישורים). עד אז — אין הרשאה." : "הוחלט.") } }); });

    if (q.mode === "authorizations") return result(authItems(), { summary: [sfact("BY_STATE", "הרשאות לפי מצב", byCount(s.authorizations.map((x) => st.authorizationState(x))), "OWNER_DECISION", "SUNNY_BRAIN")], ...partial });
    if (q.mode === "approvals") {
      const items = reqItems().sort((x, y) => Number(y.fields.state === "PENDING") - Number(x.fields.state === "PENDING"));
      return result(items, { completeness: s.approvals ? (s.truncated ? "PARTIAL" : "COMPLETE") : "UNKNOWN", coverage: t2Note, missing: s.approvals ? [] : [{ fact: "owner_approval_queue", whyNeeded: "the T2 migration is not applied" }] });
    }
    if (q.mode === "resources") return result(s.resources.map((r) => item({
      id: `resource:${r.id}`, label: record(r.displayName ?? r.firstHandle ?? r.canonicalUrl ?? r.identityKey), epistemic: "FACT", source: "SUNNY_BRAIN", freshness: st.resourceActive(r.id) ? "LIVE" : "HISTORICAL",
      fields: { resourceId: r.id, platform: r.platform, resourceKind: r.resourceKind, contentKind: r.contentKind, parentId: r.parentId, identityKey: r.identityKey, canonicalUrl: r.canonicalUrl, active: st.resourceActive(r.id), registeredBy: r.approvalBasis === "OWNER_APPROVAL" ? "OWNER_APPROVAL" : "SUNNY_UNDER_AUTHORIZATION", createdAt: r.createdAt },
    })), partial);
    if (q.mode === "observations" || q.mode === "observation_history") {
      const hist = q.mode === "observation_history";
      const list = s.observations.filter((o) => (hist || st.observationValid(o.id)) && (!q.params.resource || o.resourceId === q.params.resource) && (!q.params.entity || o.entityKey === q.params.entity)
        && (!q.params.type || o.type === q.params.type || o.type.startsWith(`${q.params.type}.`))).sort((x, y) => y.observedAt.localeCompare(x.observedAt) || y.seq - x.seq);
      return result(list.map((o) => obsItem(o, st.observationValid(o.id), st.observationEnd(o.id))), { summary: [sfact("BY_TYPE", "מדידות לפי סוג", byCount(list.map((o) => o.type)), "OBSERVATION", "SUNNY_BRAIN")], ...partial });
    }
    if (q.mode === "records") {
      const want = q.params.type && (RECORD_TYPES as readonly string[]).includes(q.params.type) ? q.params.type : null;
      const list = s.records.filter((r) => (!want || r.recordType === want) && (!q.params.status || st.recordStatus(r.id) === q.params.status) && (!q.params.entity || r.entityKeys.includes(q.params.entity)) && (!q.params.area || r.area === q.params.area)).sort((x, y) => y.seq - x.seq);
      return result(list.map((r) => recordItem(r, st.recordStatus(r.id))), { summary: [sfact("BY_STATUS", "רשומות לפי סטטוס", byCount(list.map((r) => `${r.recordType}:${st.recordStatus(r.id) ?? "?"}`)), "HYPOTHESIS", "SUNNY_BRAIN")], ...partial });
    }
    if (q.mode === "record") {
      const id = q.params.id ?? "";
      const r = UUID_RE.test(id) ? s.records.find((x) => x.id === id) : undefined;
      if (!r) return result([], { completeness: "UNKNOWN", missing: [{ fact: "record", whyNeeded: "params.id must be an existing record id (mode records lists them)" }] });
      const base = recordItem(r, st.recordStatus(r.id));
      const linkView = (l: (typeof s.links)[number]) => ({ linkId: l.id, role: l.role, from: l.fromRecordId ? { record: l.fromRecordId } : l.fromObservationId ? { observation: l.fromObservationId } : { ref: l.fromRef }, to: l.toRecordId ? { record: l.toRecordId } : l.toResourceId ? { resource: l.toResourceId } : { ref: l.toRef }, note: l.noteHe ? record(l.noteHe) : null, active: st.linkActive(l.id) });
      base.fields.history = st.recordHistory(r.id).map((e) => ({ from: e.fromStatus, to: e.toStatus, by: e.actor, at: e.createdAt, reason: e.reasonHe ? record(e.reasonHe) : null }));
      base.fields.linksIn = s.links.filter((l) => l.toRecordId === r.id).map(linkView);
      base.fields.linksOut = s.links.filter((l) => l.fromRecordId === r.id).map(linkView);
      const evIds = new Set(s.links.filter((l) => l.toRecordId === r.id && l.fromObservationId).map((l) => l.fromObservationId!));
      base.fields.evidenceObservations = s.observations.filter((o) => evIds.has(o.id)).map((o) => ({ id: o.id, type: o.type, value: valueOf(o), observedAt: o.observedAt, current: st.observationValid(o.id) }));
      return result([base]);
    }
    // overview
    const active = s.authorizations.filter((x) => st.authorizationState(x) === "ACTIVE");
    const pending = (s.approvals?.requests ?? []).filter((r) => st.approvalState(r) === "PENDING");
    return result([...authItems(active), ...reqItems().filter((i) => i.fields.state === "PENDING")], {
      summary: [
        sfact("ACTIVE_AUTHORIZATIONS", "הרשאות מעקב פעילות", active.length, "OWNER_DECISION", "SUNNY_BRAIN"),
        sfact("PENDING_APPROVALS", "בקשות שמחכות לבוס", s.approvals ? pending.length : null, "FACT", "SUNNY_BRAIN"),
        sfact("RESOURCES", "מקורות במעקב (פעילים)", s.resources.filter((r) => st.resourceActive(r.id)).length, "FACT", "SUNNY_BRAIN"),
        sfact("CURRENT_OBSERVATIONS", "מדידות נוכחיות", s.observations.filter((o) => st.observationValid(o.id)).length, "OBSERVATION", "SUNNY_BRAIN"),
        sfact("RECORDS_BY_STATUS", "תובנות / המלצות לפי סטטוס", byCount(s.records.map((r) => `${r.recordType}:${st.recordStatus(r.id) ?? "?"}`)), "HYPOTHESIS", "SUNNY_BRAIN"),
      ],
      coverage: t2Note, ...(s.truncated ? { completeness: "PARTIAL" as const } : {}),
    });
  },
};
