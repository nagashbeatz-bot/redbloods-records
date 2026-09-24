/**
 * Redbloods Partner knowledge — COMPANY + PARTNER capabilities: the catalog, what Partner needs from the Owner,
 * Company Integrity, known unknowns, Cases, Outcomes, Owner decisions, organizational memory.
 * Pure readers over existing Partner layers — no business rule is re-implemented here.
 */
import { caseSubjectKey, eventFreshness, gatewayEntityOfMemoryKey } from "../../gateway/core";
import { sha256Hex } from "../../actions/canonical";
import type { IntegrityFinding } from "../../integrity/types";
import type { KnowledgeRegistry } from "../registry";
import type { KnowledgeCapability, KnowledgeDomain, KnowledgeItem } from "../types";
import { byCount, item, ok, partner, partnerRecord, record, result, sfact, unavailable } from "./common";
import { encodeQuestionRef } from "../../bridge/ref";
import type { IntegrityQuestion } from "../../integrity/types";

/** P1: the opaque ref + option codes a connector with partner:answer may use (the ref is re-validated live). */
const answerRef = (q: IntegrityQuestion) => ({ questionRef: encodeQuestionRef({ kind: "integrity", questionId: q.questionId, subjectId: q.subject.id, fingerprint: q.fingerprint }), options: q.options.map((o) => ({ code: o.code, label: partner(o.labelHe) })) });

const DOMAINS: KnowledgeDomain[] = ["COMPANY", "PARTNER", "FINANCE", "PROJECTS", "CLIENTS", "SALES", "LABEL", "SHOWS", "SESSIONS", "TEAM"];
const EPI = (e: string) => (e === "FACT" || e === "DERIVED" || e === "OWNER_DECISION" || e === "HYPOTHESIS" ? e : "UNKNOWN") as KnowledgeItem["epistemic"];
/** A stable, neutral id: entity keys stay (they are public Gateway keys); internal register subject keys are hashed (no table / column names). */
const findingId = (f: IntegrityFinding) => `${f.type}:${f.subject.type === "label-artist" ? f.subject.key : `${f.subject.type}-${sha256Hex(f.subject.key).slice(0, 10)}`}`;
const WHERE_TO_ANSWER = "הבעלים עונה בלוח הבקרה של Redbloods (\"צריך ממך\"), או — רק אם החיבור קיבל את הרשאת המענה — לענות ל־Claude בשיחה, ו־Claude ישלח את התשובה הסגורה (partner_answer_question).";

/** The catalog is itself a capability: discovery goes through the same allowlist. */
export function catalogCapability(getRegistry: () => KnowledgeRegistry): KnowledgeCapability {
  return {
    id: "catalog", domain: "PARTNER", titleHe: "מה Partner יודע",
    descriptionForModel: "Lists every Partner knowledge capability you may query (id, what it answers, modes, parameters). Call this first when unsure which capability answers the Owner's question.",
    examplesHe: ["מה אתה יודע?", "על מה אפשר לשאול אותך?"],
    modes: { list: { descriptionForModel: "All capabilities available to you, optionally one domain" } }, defaultMode: "list",
    params: { domain: { kind: "enum", values: DOMAINS, descriptionForModel: "Only this domain" } },
    paging: { defaultLimit: 50, maxLimit: 50 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: [],
    read(src, q) {
      const d = getRegistry().describe(src.audience ?? { channel: "EXTERNAL", ownerAuthorized: false }, q.params.domain as KnowledgeDomain | undefined);
      return result(d.map((c) => item({ id: c.id, label: partner(c.title), epistemic: "FACT", source: "PARTNER_KNOWLEDGE", fields: { capability: c.id, domain: c.domain, description: c.description, examples: c.examples, modes: c.modes, defaultMode: c.defaultMode, params: c.params, paging: c.paging, ownerOnly: c.ownerOnly, sensitivity: c.sensitivity, enrichesEntities: c.entityScope } })),
        { summary: [sfact("CAPABILITIES", "יכולות זמינות", d.length, "FACT", "PARTNER_KNOWLEDGE")] });
    },
  };
}

export const ownerNeeds: KnowledgeCapability = {
  id: "owner_needs", domain: "PARTNER", titleHe: "מה Partner צריך מהבעלים",
  descriptionForModel: "What Partner currently needs from the Owner: open Owner questions (business definitions such as label project classification, finance questions) and suggested actions waiting for the Owner's decision. Answers happen ONLY in the Redbloods dashboard, never through this connector. Use for 'what do you need from me?'.",
  examplesHe: ["מה אתה צריך ממני?", "יש משהו שמחכה לי?", "על מה אני צריך להחליט?"],
  modes: { current: { descriptionForModel: "Everything currently waiting for the Owner (questions are capped by Partner at 2 per area; deferred ones are counted)" } }, defaultMode: "current",
  params: {}, paging: { defaultLimit: 10, maxLimit: 20 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" },
  needs: ["INTEGRITY", "FINANCE", "ACTIONS"],
  read(src) {
    const items: KnowledgeItem[] = [];
    const missing = [];
    const reg = ok(src.integrity);
    if (reg) {
      for (const q of reg.questions) {
        items.push(item({
          id: `integrity:${q.subject.type}:${q.subject.id}`, entity: q.subject.type === "label-artist" ? `label-artist:${q.subject.id}` : null,
          label: partnerRecord(q.textHe), epistemic: "UNKNOWN", source: "INTEGRITY",
          fields: {
            kind: "OWNER_QUESTION", area: "COMPANY_INTEGRITY", topic: q.questionType, subject: record(q.subject.label), why: partnerRecord(q.whyHe),
            evidence: q.evidenceHe.map((e) => partnerRecord(e)), options: q.options.map((o) => partner(o.labelHe)),
            previousAnswer: q.previousAnswer ? { answer: partner(q.previousAnswer.answerLabelHe), answeredAt: q.previousAnswer.answeredAt } : null,
            whereToAnswer: partner(WHERE_TO_ANSWER), answer: answerRef(q),
          },
        }));
      }
    } else missing.push({ fact: "Company Integrity questions", whyNeeded: "the integrity register could not be read — open definition questions may exist" });
    const f = ok(src.finance);
    if (f?.brief) {
      f.brief.rehab.questions.forEach((q, i) => items.push(item({
        id: `finance:q${i}`, label: partnerRecord(q.textHe), epistemic: "UNKNOWN", source: "FINANCE",
        fields: { kind: "OWNER_QUESTION", area: "FINANCE", topic: q.questionType, why: partnerRecord(q.whyHe), options: q.options.map((o) => partner(o.labelHe)), whereToAnswer: partner(WHERE_TO_ANSWER) },
      })));
    } else if (f && !f.answersAvailable) missing.push({ fact: "Finance Owner questions", whyNeeded: "hidden until Owner answers can be read (never re-ask blindly)" });
    else if (!f) missing.push({ fact: "Finance Owner questions", whyNeeded: "the Finance Brain could not be read" });
    const acts = ok(src.actions);
    for (const a of acts ?? []) {
      items.push(item({
        id: `action:${a.actionId}`, entity: a.actionType === "UPDATE_PROJECT_DEADLINE" ? `project:${a.projectId}` : null,
        label: partnerRecord(a.actionType === "UPDATE_PROJECT_DEADLINE" ? `${a.projectName}: דדליין ${a.currentDeadlineHe} → ${a.suggestedDeadlineHe}` : a.headlineHe),
        epistemic: "DERIVED", source: "ACTIONS",
        fields: { kind: a.state === "AWAITING_EXECUTION" ? "APPROVED_AWAITING_EXECUTION" : "ACTION_AWAITING_DECISION", actionType: a.actionType, requiresOwnerApproval: true, whereToDecide: partner("בלוח הבקרה של Redbloods בלבד") },
      }));
    }
    if (!acts) missing.push({ fact: "suggested actions", whyNeeded: "the Action surface could not be read" });
    return result(items, {
      summary: [
        sfact("OPEN_QUESTIONS", "שאלות פתוחות לבעלים (מוצגות עכשיו)", items.filter((i) => i.fields.kind === "OWNER_QUESTION").length, "FACT", "PARTNER_KNOWLEDGE"),
        ...(reg ? [sfact("DEFERRED_QUESTIONS", "שאלות נוספות שנדחו (יוצגו אחרי שאלה שתיענה)", reg.deferredQuestions, "FACT", "INTEGRITY")] : []),
        sfact("ACTIONS_WAITING", "פעולות שמחכות להחלטת הבעלים", (acts ?? []).length, "FACT", "ACTIONS"),
      ],
      completeness: missing.length ? "UNKNOWN" : "COMPLETE", missing,
    });
  },
};

export const integrity: KnowledgeCapability = {
  id: "integrity", domain: "COMPANY", titleHe: "אי-התאמות ושאלות הגדרה בחברה",
  descriptionForModel: "Partner's Company Integrity Register: where company data sources disagree or are incomplete (label roster vs other sources, label projects marked as client work, schedule and release-plan coverage gaps, Victor/Steven source conflicts, label economics without currency, data quality), with Partner's stance (KNOWN / DERIVED / OWNER_DECIDED / CONFLICT / UNKNOWN / NEEDS_OWNER), the Owner questions it raises, and what Partner learned from Owner answers. Nothing here changes data.",
  examplesHe: ["איפה יש אי-התאמות?", "מה לא מסתדר בנתונים?", "מה למדת ממני?"],
  modes: {
    findings: { descriptionForModel: "Live findings (optionally about one label artist, or one stance)" },
    questions: { descriptionForModel: "Owner questions surfaced right now (max 2) + how many are deferred" },
    learned: { descriptionForModel: "Owner decisions Partner learned and whether they still apply to the live facts" },
  },
  defaultMode: "findings",
  params: {
    entity: { kind: "entityKey", types: ["label-artist"], descriptionForModel: "Only findings / questions / decisions about this label artist" },
    stance: { kind: "enum", values: ["KNOWN", "DERIVED", "OWNER_DECIDED", "CONFLICT", "UNKNOWN", "NEEDS_OWNER"], descriptionForModel: "Only findings with this stance" },
  },
  entityScope: { types: ["label-artist"], param: "entity", mode: "findings", limit: 6 },
  paging: { defaultLimit: 20, maxLimit: 40 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["INTEGRITY"],
  read(src, q) {
    const reg = ok(src.integrity);
    if (!reg) return unavailable("Company Integrity Register");
    const about = q.params.entity ?? null;
    const coverage = [partner("ממצאי שלמות נגזרים בכל קריאה מהנתונים החיים ולא נשמרים. שום נתון עסקי לא משתנה בעקבותיהם.")];
    if (q.mode === "questions") {
      const qs = reg.questions.filter((x) => !about || `${x.subject.type}:${x.subject.id}` === about);
      return result(qs.map((x) => item({ id: `question:${x.subject.type}:${x.subject.id}`, entity: x.subject.type === "label-artist" ? `label-artist:${x.subject.id}` : null, label: partnerRecord(x.textHe), epistemic: "UNKNOWN", source: "INTEGRITY",
        fields: { kind: "OWNER_QUESTION", topic: x.questionType, subject: record(x.subject.label), why: partnerRecord(x.whyHe), evidence: x.evidenceHe.map((e) => partnerRecord(e)), options: x.options.map((o) => partner(o.labelHe)), previousAnswer: x.previousAnswer ? partner(x.previousAnswer.answerLabelHe) : null, whereToAnswer: partner(WHERE_TO_ANSWER), answer: answerRef(x) } })),
        { summary: [sfact("DEFERRED_QUESTIONS", "שאלות שנדחו", reg.deferredQuestions, "FACT", "INTEGRITY")], coverage });
    }
    if (q.mode === "learned") {
      const ls = reg.learned.filter((l) => !about || l.entityKey === about);
      return result(ls.map((l) => item({ id: `learned:${l.decision.contextId}`, entity: l.entityKey.startsWith("label-artist:") ? l.entityKey : null, label: partnerRecord(l.interpretationHe), epistemic: "OWNER_DECISION", source: "OWNER_CONTEXT",
        freshness: l.status === "APPLIES" ? "LIVE" : "HISTORICAL",
        fields: { subject: record(l.subjectLabel), answer: partner(l.decision.answerLabelHe), answeredAt: l.decision.answeredAt, status: l.status, basis: l.decision.basis, askedAs: partnerRecord(l.askedHe) } })), { coverage });
    }
    const fs = reg.findings.filter((f) => (!about || f.subject.key === about) && (!q.params.stance || f.stance === q.params.stance));
    const items = fs.map((f) => item({
      id: findingId(f), entity: f.subject.type === "label-artist" ? f.subject.key : null, label: partnerRecord(f.interpretationHe), epistemic: EPI(f.epistemic), source: "INTEGRITY",
      fields: {
        type: f.type, stance: f.stance, severity: f.severity, subject: record(f.subject.label), ownerInputRequired: f.ownerInputRequired, askedNow: f.questionId !== null,
        ownerDecision: f.ownerDecision ? { answer: partner(f.ownerDecision.answerLabelHe), answeredAt: f.ownerDecision.answeredAt, basis: f.ownerDecision.basis, epistemic: "OWNER_DECISION" } : null,
        conflictingSources: f.conflictingSources.length,
      },
    }));
    if (about) {
      for (const x of reg.questions.filter((x) => `${x.subject.type}:${x.subject.id}` === about)) {
        items.push(item({ id: `question:${about}`, entity: about, label: partnerRecord(x.textHe), epistemic: "UNKNOWN", source: "INTEGRITY", fields: { kind: "OWNER_QUESTION_OPEN", topic: x.questionType, options: x.options.map((o) => partner(o.labelHe)), whereToAnswer: partner(WHERE_TO_ANSWER), answer: answerRef(x) } }));
      }
    }
    return result(items, { summary: [sfact("STANCES", "ממצאים לפי עמדת Partner", reg.summary, "DERIVED", "INTEGRITY"), sfact("OPEN_QUESTIONS", "שאלות פתוחות לבעלים", reg.questions.length, "FACT", "INTEGRITY")], coverage });
  },
};

export const knownUnknowns: KnowledgeCapability = {
  id: "known_unknowns", domain: "COMPANY", titleHe: "מה Partner לא יודע",
  descriptionForModel: "What Partner explicitly does NOT know or cannot conclude: unknown / conflicting integrity findings, finance coverage gaps and unknown-epistemic finance signals, sources not read (e.g. Google Calendar is not read, so the future schedule is unknown). Use for 'what don't you know?' and before stating that something does not exist.",
  examplesHe: ["מה אתה לא יודע?", "איפה המידע חסר?", "על מה אי אפשר לסמוך?"],
  modes: { current: { descriptionForModel: "Current known unknowns" } }, defaultMode: "current",
  params: {}, paging: { defaultLimit: 20, maxLimit: 40 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["INTEGRITY", "FINANCE"],
  read(src) {
    const items: KnowledgeItem[] = [];
    const missing = [];
    const reg = ok(src.integrity);
    if (reg) {
      for (const f of reg.findings.filter((x) => x.stance === "UNKNOWN" || x.stance === "CONFLICT" || x.stance === "NEEDS_OWNER")) {
        items.push(item({ id: findingId(f), entity: f.subject.type === "label-artist" ? f.subject.key : null, label: partnerRecord(f.interpretationHe), epistemic: f.stance === "UNKNOWN" ? "UNKNOWN" : EPI(f.epistemic), source: "INTEGRITY", fields: { area: "COMPANY_INTEGRITY", type: f.type, stance: f.stance, subject: record(f.subject.label) } }));
      }
    } else missing.push({ fact: "Company Integrity Register", whyNeeded: "unknowns in company data could not be listed" });
    const f = ok(src.finance);
    if (f) {
      for (const [k, c] of Object.entries(f.state.coverage).sort(([a], [b]) => a.localeCompare(b))) {
        if (c.state === "RELIABLE") continue;
        items.push(item({ id: `finance-coverage:${k}`, label: partner(`כיסוי נתוני כספים "${k}": ${c.state}`), epistemic: "UNKNOWN", source: "FINANCE", fields: { area: "FINANCE_COVERAGE", key: k, coverage: c.state, reason: partnerRecord(c.reason) } }));
      }
      for (const s of f.state.signals.filter((x) => x.epistemic === "UNKNOWN")) {
        items.push(item({ id: `finance-signal:${s.code}`, label: partner(`אות כספי לא ודאי: ${s.code}`), epistemic: "UNKNOWN", source: "FINANCE", fields: { area: "FINANCE_SIGNAL", code: s.code, count: s.count, amountsByCurrency: s.amounts } }));
      }
    } else missing.push({ fact: "Finance Brain", whyNeeded: "finance unknowns could not be listed" });
    return result(items, { completeness: missing.length ? "UNKNOWN" : "COMPLETE", missing, coverage: [partner("Google Calendar לא נקרא על ידי Partner — היומן העתידי חלקי/לא ידוע."), partner("אין יומן ביקורת עסקי מלא — ציר ראיות אינו היסטוריה מלאה.")] });
  },
};

export const cases: KnowledgeCapability = {
  id: "cases", domain: "COMPANY", titleHe: "מקרים פתוחים של Partner",
  descriptionForModel: "Partner's live Cases: deterministic business conditions that need attention (passed deadlines, outstanding payments, proposals needing follow-up, Victor/Steven deadlines, tasks past due …) with classification RISK / ATTENTION / OPPORTUNITY / INFORMATION. No priority model: order is classification then type.",
  examplesHe: ["מה פתוח?", "איפה יש סיכון?", "מה דורש תשומת לב?"],
  modes: { open: { descriptionForModel: "Current open cases" } }, defaultMode: "open",
  params: { classification: { kind: "enum", values: ["RISK", "ATTENTION", "OPPORTUNITY", "INFORMATION"], descriptionForModel: "Only this classification" } },
  paging: { defaultLimit: 15, maxLimit: 40 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["CASES"],
  read(src, q) {
    const cs = ok(src.cases);
    if (!cs) return unavailable("Partner Cases");
    const order = ["RISK", "ATTENTION", "OPPORTUNITY", "INFORMATION"];
    const list = cs.filter((c) => !q.params.classification || c.classification === q.params.classification)
      .sort((a, b) => order.indexOf(a.classification) - order.indexOf(b.classification) || a.caseType.localeCompare(b.caseType) || a.subjectId.localeCompare(b.subjectId));
    return result(list.map((c) => item({ id: c.id, entity: caseSubjectKey(c), label: partnerRecord(c.summaryHe), epistemic: "DERIVED", source: "CASES", fields: { caseType: c.caseType, classification: c.classification, status: c.status, unknowns: c.unknowns.length } })),
      { summary: [sfact("BY_CLASSIFICATION", "מקרים לפי סיווג", byCount(list.map((c) => c.classification)), "DERIVED", "CASES")] });
  },
};

export const outcomes: KnowledgeCapability = {
  id: "outcomes", domain: "PARTNER", titleHe: "פעולות שבוצעו לאחרונה",
  descriptionForModel: "Actions the Owner approved and executed through Partner, each with its current derived Outcome (did live data keep the expected effect?). Only these are things that actually happened through Partner.",
  examplesHe: ["מה בוצע לאחרונה?", "מה עשית בשבילי?"],
  modes: { recent: { descriptionForModel: "Recent executed actions" } }, defaultMode: "recent",
  params: {}, paging: { defaultLimit: 10, maxLimit: 20 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["OUTCOMES"],
  read(src) {
    const os = ok(src.outcomes);
    if (!os) return unavailable("recent outcomes");
    return result([...os].sort((a, b) => b.executedAt.localeCompare(a.executedAt)).map((o) => item({
      id: o.executedEventId, entity: o.actionType === "UPDATE_PROJECT_DEADLINE" ? `project:${o.projectId}` : null, label: partnerRecord(o.headlineHe), epistemic: "FACT", source: "OUTCOMES",
      freshness: eventFreshness(o.executedAt, src.now), fields: { actionType: o.actionType, outcomeState: o.state, status: partnerRecord(o.statusHe), executedAt: o.executedAt },
    })));
  },
};

export const ownerDecisions: KnowledgeCapability = {
  id: "owner_decisions", domain: "PARTNER", titleHe: "החלטות ותשובות של הבעלים",
  descriptionForModel: "Every Owner answer Partner holds as durable organizational knowledge (OWNER_DECISION, never a database fact): finance answers, deadline decisions, business definitions (e.g. how to treat a label artist's projects). ACTIVE = in use; SUPERSEDED = revised later (history).",
  examplesHe: ["מה החלטתי?", "מה אמרתי לך על שליו?", "איזה החלטות שלי אתה זוכר?"],
  modes: { active: { descriptionForModel: "Decisions in use now" }, all: { descriptionForModel: "Including superseded / no-longer-applicable history" } }, defaultMode: "active",
  params: {}, paging: { defaultLimit: 20, maxLimit: 50 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["MEMORY", "INTEGRITY"],
  read(src, q) {
    const mem = ok(src.memory);
    if (!mem) return unavailable("organizational memory");
    const learned = new Map((ok(src.integrity)?.learned ?? []).map((l) => [l.decision.contextId, l]));
    const ds = mem.entities.flatMap((m) => m.ownerDecisions.map((d) => ({ m, d }))).filter(({ d }) => q.mode === "all" || d.status === "ACTIVE")
      .sort((a, b) => b.d.answeredAt.localeCompare(a.d.answeredAt) || a.d.contextId.localeCompare(b.d.contextId));
    return result(ds.map(({ m, d }) => {
      const l = learned.get(d.contextId);
      return item({
        id: d.contextId, entity: gatewayEntityOfMemoryKey(m.entity.key), label: l ? partnerRecord(l.interpretationHe) : partner(`${d.questionType}: ${d.answerCode}`), epistemic: "OWNER_DECISION", source: "OWNER_CONTEXT",
        freshness: d.status === "ACTIVE" ? "LIVE" : "STALE",
        fields: { questionType: d.questionType, answerCode: d.answerCode, answer: l ? partner(l.decision.answerLabelHe) : null, answerDate: d.answerValueYmd, answeredAt: d.answeredAt, status: d.status, appliesToLiveFacts: l ? l.status : null },
      });
    }), { completeness: ok(src.integrity) ? "COMPLETE" : "PARTIAL" });
  },
};

export const memory: KnowledgeCapability = {
  id: "memory", domain: "PARTNER", titleHe: "זיכרון ארגוני",
  descriptionForModel: "Partner's organizational memory beyond single answers: recurring-problem observations per entity (with live override), pattern candidates (never rules), and source conflicts Partner could not resolve (e.g. Victor salary sources disagreeing for a month).",
  examplesHe: ["מה קרה עם המשכורת של Victor באוגוסט?", "יש דפוסים חוזרים?", "איפה המקורות סותרים?"],
  modes: { observations: { descriptionForModel: "Observed problems per entity (current or resolved)" }, patterns: { descriptionForModel: "Pattern candidates / confirmed patterns" }, conflicts: { descriptionForModel: "Unresolved source conflicts" } },
  defaultMode: "observations",
  params: { entity: { kind: "entityKey", types: ["vendor", "recurring", "project", "label-artist"], descriptionForModel: "Only this entity (children included)" } },
  paging: { defaultLimit: 20, maxLimit: 40 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["MEMORY"],
  read(src, q) {
    const mem = ok(src.memory);
    if (!mem) return unavailable("organizational memory");
    const want = q.params.entity ?? null;
    const ents = mem.entities.filter((m) => !want || m.entity.key === want || m.entity.parents.includes(want));
    if (q.mode === "patterns") {
      const ps = [...mem.patternCandidates.map((p) => ({ p, s: "CANDIDATE" })), ...mem.confirmedPatterns.map((p) => ({ p, s: "CONFIRMED" }))];
      return result(ps.map(({ p, s }) => item({ id: `${s}:${p.signature.entityFamily}|${p.signature.issueType}`, label: partnerRecord(p.noteHe), epistemic: "PATTERN_CANDIDATE", source: "MEMORY", fields: { status: s, family: p.signature.entityFamily, issueType: p.signature.issueType, evidenceQuality: p.evidenceQuality, instances: p.instances.length, contested: p.contestedInstances.length } })));
    }
    if (q.mode === "conflicts") {
      return result(ents.flatMap((m) => m.conflicts.map((c) => item({ id: `${m.entity.key}:${c.code}`, entity: gatewayEntityOfMemoryKey(m.entity.key), label: partner(`מקורות סותרים: ${c.code}`), epistemic: "UNKNOWN", source: "MEMORY", fields: { entityLabel: m.entity.labelHe ? partnerRecord(m.entity.labelHe) : null, values: c.values.map((v) => ({ source: v.source, value: v.value })), reportedWinner: c.winning } }))));
    }
    return result(ents.flatMap((m) => m.observations.map((o) => item({
      id: `${m.entity.key}:${o.signature.issueType}`, entity: gatewayEntityOfMemoryKey(m.entity.key), label: partner(`תצפית: ${o.signature.issueType}`), epistemic: "OBSERVATION", source: "MEMORY",
      freshness: o.current ? "LIVE" : "HISTORICAL", fields: { entityLabel: m.entity.labelHe ? partnerRecord(m.entity.labelHe) : null, current: o.current, contested: o.contested, resolution: m.resolutions.find((r) => r.resolvedIssue === o.signature.issueType)?.code ?? null },
    }))));
  },
};
