/**
 * project_memory (Phase 1, Owner decision 2026-10-01) — what Sunny knows about one project, in three separate layers:
 * CANONICAL (records) · OWNER MEMORY (the Owner's linked updates, OWNER_REPORTED) · SUNNY UNDERSTANDING (HYPOTHESIS +
 * freshness). Canonical wins; an outdated understanding is context, never the current next step. Read-only.
 */
import type { KnowledgeCapability, KnowledgeItem } from "../types";
import { item, ok, partner, partnerRecord, record, result, sfact, unavailable } from "./common";
import { buildProjectMemory } from "../../projects/memory";
import { BALL_WITH_HE, CONFIDENCE_HE, type BallWith, type Confidence } from "../../../inbox-memory";

export const projectMemory: KnowledgeCapability = {
  id: "project_memory", domain: "PROJECTS", titleHe: "זיכרון הפרויקט",
  descriptionForModel: "One project's memory in three layers that never mix: CANONICAL (status, deadline, live ball, latest recorded event — records win), OWNER MEMORY (the Owner's 'עדכון לסאני' updates LINKED to it, OWNER_REPORTED) and SUNNY UNDERSTANDING (the current interpretation: what happened, reported done, open gaps, blockers, ball, inferred next step, confidence — epistemic HYPOTHESIS, with freshness CURRENT / OUTDATED_BY_CANONICAL / BALL_CONFLICT / UNVERIFIED). The inferred next step counts only when CURRENT. summary = compact; history = every interpretation (superseded / retracted) + links with ids (to correct / retract).",
  examplesHe: ["מה קורה עם Closer?", "מה פתוח בשיר של טל?", "מה הבנת מהעדכונים שלי על הפרויקט?"],
  modes: { summary: { descriptionForModel: "Compact: canonical now + latest linked updates + the current understanding" }, history: { descriptionForModel: "Plus every interpretation (head / superseded / retracted) and every link with its id" } }, defaultMode: "summary",
  params: { project: { kind: "entityKey", types: ["project"], descriptionForModel: "The project (required)" } },
  entityScope: { types: ["project"], param: "project", mode: "summary", limit: 6 },
  paging: { defaultLimit: 20, maxLimit: 40 }, recordTextLimit: 300,
  access: { externalRead: true, ownerOnly: true, sensitivity: "PERSONAL" }, needs: ["STATE", "OPERATIONS", "OWNER_INBOX"],
  read(src, q) {
    const key = q.params.project;
    if (!key?.startsWith("project:")) return result([], { completeness: "UNKNOWN", missing: [{ fact: "project", whyNeeded: "project memory is per project — pass params.project" }] });
    if (!ok(src.state)) return unavailable("מצב החברה");
    const m = buildProjectMemory(src, key.slice("project:".length), q.mode === "history" ? "history" : "summary");
    if (!m.found) return result([], { completeness: "UNKNOWN", missing: [{ fact: key, whyNeeded: "no such project in the company state" }] });
    const items: KnowledgeItem[] = [];
    const u = m.understanding;
    // an entity section with nothing linked and no understanding stays empty (no noise in partner_entity)
    if (!u && !m.ownerMemory.total && q.mode !== "history") return result([], { completeness: m.memoryRead ? "COMPLETE" : "UNKNOWN", ...(m.memoryRead ? {} : { coverage: [partner("זיכרון העדכונים לא נקרא — אין לפרש זאת כ\"אין עדכונים\".")] }) });
    if (u) items.push(item({
      id: `understanding:${u.id}`, entity: key, label: partnerRecord(u.whatHappened), epistemic: "HYPOTHESIS", source: "OWNER_INBOX", freshness: u.freshness === "CURRENT" ? "LIVE" : "HISTORICAL",
      fields: {
        layer: "SUNNY_UNDERSTANDING", interpretationId: u.id, fromItem: u.itemId, writtenAt: u.writtenAt, recordedAt: u.recordedAt,
        reportedDone: u.completed.map((x) => record(x)), openGaps: u.openGaps.map((x) => record(x)), blockers: u.blockers.map((x) => record(x)),
        ballWith: u.ballWith, ballWithHe: partner(BALL_WITH_HE[u.ballWith as BallWith] ?? u.ballWith),
        inferredNextStep: u.inferredNextStep ? record(u.inferredNextStep) : null, nextStepIsCurrent: u.freshness === "CURRENT",
        confidence: u.confidence, confidenceHe: partner(CONFIDENCE_HE[u.confidence as Confidence] ?? u.confidence),
        freshness: u.freshness, freshnessHe: partner(u.freshnessHe), basis: u.basis, supersedeKind: u.supersedeKind, canonical: false,
        ruleHe: partner("הבנה של סאני (HYPOTHESIS) — לא מצב הפרויקט. אם הרשומות השתנו אחריה, הרשומות גוברות."),
      },
    }));
    items.push(item({
      id: `canonical:${key}`, entity: key, label: partner(`מצב ברשומות: ${m.canonical.status ?? "?"}`), epistemic: "FACT", source: "PROJECTS",
      fields: { layer: "CANONICAL", status: m.canonical.status, deadline: m.canonical.deadline, liveBall: m.canonical.ball, lastRecordedEventAt: m.canonical.lastEventAt, signals: m.canonical.signals.map((s) => ({ code: s.code, he: partner(s.he) })), read: m.canonical.read },
    }));
    for (const o of m.ownerMemory.latest) items.push(item({
      id: `update:${o.itemId}`, entity: key, label: record(o.text), epistemic: "OWNER_REPORTED", source: "OWNER_INBOX", relationQuality: o.linkQuality === "OWNER_CONFIRMED" ? "OWNER_CONFIRMED" : "DERIVED",
      fields: { layer: "OWNER_MEMORY", itemId: o.itemId, writtenAt: o.writtenAt, linkId: o.linkId, linkQuality: o.linkQuality, itemStatus: o.status, outcome: o.outcome, canonical: false },
    }));
    if (m.history) for (const h of m.history) items.push(item({
      id: `history:${h.id}`, entity: key, label: partnerRecord(h.whatHappened), epistemic: "HYPOTHESIS", source: "OWNER_INBOX", freshness: "HISTORICAL",
      fields: { layer: "SUNNY_UNDERSTANDING_HISTORY", interpretationId: h.id, fromItem: h.itemId, recordedAt: h.recordedAt, state: h.state, supersedeKind: h.supersedeKind, supersedeReason: h.supersedeReason ? record(h.supersedeReason) : null, retractedReason: h.retractedReason ? record(h.retractedReason) : null },
    }));
    if (m.links) for (const l of m.links) items.push(item({
      id: `link:${l.linkId}`, entity: key, label: record(l.surface), epistemic: "DERIVED", source: "OWNER_INBOX", relationQuality: l.quality === "OWNER_CONFIRMED" ? "OWNER_CONFIRMED" : "DERIVED",
      fields: { layer: "LINK", linkId: l.linkId, itemId: l.itemId, quality: l.quality, method: l.method, retracted: l.retracted, retractedReason: l.retractedReason ? record(l.retractedReason) : null },
    }));
    return result(items, {
      summary: [
        sfact("CURRENT_NEXT_STEP", "הצעד הבא לפי ההבנה (רק כשעדכנית)", m.currentNextStep, "HYPOTHESIS", "OWNER_INBOX"),
        sfact("LINKED_UPDATES", "עדכונים מקושרים", m.ownerMemory.total, "OWNER_REPORTED", "OWNER_INBOX"),
        sfact("INTERPRETATIONS", "גרסאות הבנה (כולל היסטוריה)", m.historyCount, "HYPOTHESIS", "OWNER_INBOX"),
      ],
      completeness: m.memoryRead && m.canonical.read ? "COMPLETE" : "PARTIAL",
      coverage: [
        partner("שלוש שכבות נפרדות: מה שכתבת (OWNER_REPORTED) ≠ מה שסאני הבינה (HYPOTHESIS) ≠ מה שברשומות (עובדה). הרשומות גוברות."),
        ...(m.canonical.read ? [] : [partner("מצב הפרויקט ברשומות לא נקרא במלואו — ההבנה לא נבדקה מולו (UNVERIFIED).")]),
        ...(m.memoryRead ? [] : [partner("זיכרון העדכונים לא נקרא — אין לפרש זאת כ\"אין עדכונים\".")]),
      ],
    });
  },
};
