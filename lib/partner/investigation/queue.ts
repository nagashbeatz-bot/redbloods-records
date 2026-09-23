/**
 * Redbloods Partner — Investigation Attention Queue (Phase F.1D). Pure,
 * deterministic, no I/O, no LLM, no clock.
 *
 * INVESTIGATE_BEFORE_CONCLUDING decides THAT a question exists. This queue
 * decides WHEN to surface it: a COO-style "these few now", with everything
 * else kept — explicitly, with a reason — in the backlog. "Not recommended
 * now" never means "resolved".
 *
 * No black-box score. Every question gets:
 *   - named FACTORS, each with a deterministic basis (RAISES / LOWERS / NOTE),
 *   - a BAND (NOW / SOON / BACKGROUND) from a short, ordered rule list,
 *   - an ordering inside the band that compares named factors in a fixed
 *     order (lexicographic), then recency of ACTIVITY, then questionId.
 * Age of a Case (days late / overdue / since delivery) is NEVER a priority
 * input — Owner Rule STALE_IS_NOT_AUTOMATICALLY_URGENT. It is recorded as a
 * NOTE only.
 *
 * AttentionPolicy is a working PRODUCT policy (budget, per-subject and
 * per-type caps, windows) — not an Owner Rule, not in the Charter, and
 * changeable by passing a different policy.
 */
import type { PartnerCase } from "../cases/types";
import { fingerprintCaseFacts } from "../feedback/snapshot";
import { decideInvestigations } from "./questions";
import { resolveCurrentContexts } from "./interpret";
import type { InvestigationQuestionType, PartnerInvestigationQuestion, PartnerOwnerContext } from "./types";

export interface AttentionPolicy {
  /** Max questions recommended in one review/session. */
  maxRecommended: number;
  /** Max recommended questions per attention anchor (a project, or a standalone subject). */
  maxPerAnchor: number;
  /** Max recommended questions of the same question type — keeps a batch from being "5 of the same thing". */
  maxPerQuestionType: number;
  /** A linked project updated within this many days counts as RECENT_ACTIVITY. */
  recentActivityDays: number;
  /** A delivery younger than this is TOO_EARLY_TO_ASK whether it was reviewed. */
  deliveryGraceDays: number;
}

export const DEFAULT_ATTENTION_POLICY: AttentionPolicy = {
  maxRecommended: 5,
  maxPerAnchor: 1,
  maxPerQuestionType: 2,
  recentActivityDays: 7,
  deliveryGraceDays: 2,
};

/** Explicit project evidence (from Partner Eyes — projects.open). No names: the queue never needs them. */
export interface AttentionProjectInfo {
  status: string;
  /** lib/coo ProjectFact.active — not completed / cancelled / on hold. */
  active: boolean;
  /** "לייבל" marks a label project (explicit field, not inferred). */
  businessType: string;
  daysSinceUpdate: number | null;
}

/** Explicit release evidence (Partner Eyes — releasesFull), keyed by projectId. */
export interface AttentionReleaseInfo { labelArtistId: string | null; stage: string }

export interface AttentionInput {
  cases: readonly PartnerCase[];
  /** Owner Context records (all history is fine — only the current answer per question is used). */
  contexts?: readonly PartnerOwnerContext[];
  /** Keyed by projectId. A projectId missing here = not an open project in Partner's scope (closed/hidden) — never guessed. */
  projects?: Readonly<Record<string, AttentionProjectInfo>>;
  releases?: Readonly<Record<string, AttentionReleaseInfo>>;
  policy?: AttentionPolicy;
}

export type AttentionFactorCode =
  | "RISK_CLASSIFICATION"
  | "ATTENTION_CLASSIFICATION"
  | "INFORMATION_CLASSIFICATION"
  | "OWNER_RULE_PROTECT_LABEL_RELEASES"
  | "OWNER_RULE_INTERNAL_DEADLINES_MATTER"
  | "ACTIVE_PROJECT"
  | "INACTIVE_PROJECT"
  | "LINKED_PROJECT_NOT_OPEN"
  | "RECENT_ACTIVITY"
  | "EVIDENCE_CHANGED_SINCE_ANSWER"
  | "TOO_EARLY_TO_ASK"
  | "STANDALONE"
  | "UNRESOLVED_CONTEXT"
  | "AGE_NOT_USED_FOR_PRIORITY"
  | "QUALITY_BEFORE_SPEED_NOTE";

export interface AttentionFactor { code: AttentionFactorCode; effect: "RAISES" | "LOWERS" | "NOTE"; basis: string }

export type AttentionBand = "NOW" | "SOON" | "BACKGROUND";
/** UNANSWERED: no current Owner Context. ANSWERED: current context exists and the Case's facts are unchanged. ANSWERED_EVIDENCE_CHANGED: answered, but the Case's facts changed since — eligible again. */
export type QuestionAnswerState = "UNANSWERED" | "ANSWERED" | "ANSWERED_EVIDENCE_CHANGED";
export type AttentionState = "RECOMMENDED" | "NOT_CURRENTLY_RECOMMENDED" | "ANSWERED_NOT_RESURFACED";
export type DeferralReason = "ANCHOR_ALREADY_REPRESENTED" | "QUESTION_TYPE_CAP" | "BUDGET_FULL" | "BACKGROUND_BAND";

export interface AttentionItem {
  question: PartnerInvestigationQuestion;
  /** `project:<id>` when the Case is on / linked to a project, else `${subjectType}:${subjectId}`. */
  anchor: string;
  band: AttentionBand;
  factors: AttentionFactor[];
  answerState: QuestionAnswerState;
  attentionState: AttentionState;
  deferralReason: DeferralReason | null;
  /** When deferred for ANCHOR_ALREADY_REPRESENTED: the recommended question that represents this anchor. */
  representedBy: string | null;
  /** 1-based position in the full deterministic ordering (all bands). */
  rank: number;
}

export interface AttentionQueue {
  policy: AttentionPolicy;
  recommended: AttentionItem[];
  /** Valid, unanswered (or evidence-changed) questions not surfaced now — still open, never resolved. */
  backlog: AttentionItem[];
  /** Currently answered, facts unchanged — not resurfaced. */
  answered: AttentionItem[];
}

// ── helpers ──

const derivedNum = (c: PartnerCase, ids: string[]): number | null => {
  const v = c.derivedFacts.find((d) => ids.includes(d.id))?.value;
  return typeof v === "number" ? v : null;
};
const linkedProjectId = (c: PartnerCase): string | null => {
  if (c.subjectType === "project") return c.subjectId;
  const v = c.facts.find((f) => f.field === "projectId")?.value;
  return typeof v === "string" && v ? v : null;
};
const DEADLINE_TYPES: ReadonlySet<InvestigationQuestionType> = new Set(["WHY_DEADLINE_STILL_ACTIVE", "WHY_INTERNAL_DEADLINE_PASSED", "WHY_RELEASE_TARGET_PASSED"]);
const BAND_ORDER: Record<AttentionBand, number> = { NOW: 0, SOON: 1, BACKGROUND: 2 };
/** Fixed comparison order for the in-band lexicographic ordering. Earlier = more decisive. */
const ORDER_FACTORS: AttentionFactorCode[] = [
  "EVIDENCE_CHANGED_SINCE_ANSWER",
  "OWNER_RULE_PROTECT_LABEL_RELEASES",
  "OWNER_RULE_INTERNAL_DEADLINES_MATTER",
  "RISK_CLASSIFICATION",
  "ACTIVE_PROJECT",
  "RECENT_ACTIVITY",
];

function assess(c: PartnerCase, q: PartnerInvestigationQuestion, input: Required<Pick<AttentionInput, "projects" | "releases">>, policy: AttentionPolicy, answer: PartnerOwnerContext | null) {
  const factors: AttentionFactor[] = [];
  const add = (code: AttentionFactorCode, effect: AttentionFactor["effect"], basis: string) => factors.push({ code, effect, basis });
  const has = (code: AttentionFactorCode) => factors.some((f) => f.code === code);

  if (c.classification === "RISK") add("RISK_CLASSIFICATION", "RAISES", "classification=RISK");
  else if (c.classification === "ATTENTION") add("ATTENTION_CLASSIFICATION", "NOTE", "classification=ATTENTION");
  else if (c.classification === "INFORMATION") add("INFORMATION_CLASSIFICATION", "LOWERS", "classification=INFORMATION");

  const pid = linkedProjectId(c);
  const project = pid ? input.projects[pid] ?? null : null;
  const release = pid ? input.releases[pid] ?? null : null;
  if (project?.businessType === "לייבל" || release?.labelArtistId) {
    add("OWNER_RULE_PROTECT_LABEL_RELEASES", "RAISES", project?.businessType === "לייבל" ? `project ${pid} businessType=לייבל` : `release ${pid} labelArtistId set`);
  }
  if (c.ownerRulesApplied.includes("INTERNAL_DEADLINES_MATTER")) add("OWNER_RULE_INTERNAL_DEADLINES_MATTER", "RAISES", "Case.ownerRulesApplied includes INTERNAL_DEADLINES_MATTER");

  let activityDays: number | null = null;
  if (pid && project) {
    if (project.active) add("ACTIVE_PROJECT", "RAISES", `project ${pid} active (status=${project.status})`);
    else add("INACTIVE_PROJECT", "LOWERS", `project ${pid} not active (status=${project.status})`);
    if (project.daysSinceUpdate !== null) {
      activityDays = project.daysSinceUpdate;
      if (project.daysSinceUpdate <= policy.recentActivityDays) add("RECENT_ACTIVITY", "RAISES", `project updated ${project.daysSinceUpdate}d ago (≤ ${policy.recentActivityDays}d window)`);
    }
  } else if (pid) {
    add("LINKED_PROJECT_NOT_OPEN", "NOTE", `project ${pid} is not in Partner's open-projects scope (closed/hidden) — no activity evidence`);
  } else {
    add("STANDALONE", "NOTE", "no project link");
  }

  if (q.questionType === "WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM") {
    const since = derivedNum(c, ["days_since_delivery"]);
    if (since !== null) {
      activityDays = activityDays === null ? since : Math.min(activityDays, since);
      if (since < policy.deliveryGraceDays) add("TOO_EARLY_TO_ASK", "LOWERS", `delivery ${since}d ago (< ${policy.deliveryGraceDays}d grace)`);
    }
  }

  let answerState: QuestionAnswerState = "UNANSWERED";
  if (answer) {
    if (answer.caseFactsFingerprint && answer.caseFactsFingerprint !== fingerprintCaseFacts(c)) {
      answerState = "ANSWERED_EVIDENCE_CHANGED";
      add("EVIDENCE_CHANGED_SINCE_ANSWER", "RAISES", `Case facts changed since context ${answer.id}`);
    } else {
      answerState = "ANSWERED";
    }
  }
  if (answerState !== "ANSWERED") add("UNRESOLVED_CONTEXT", "NOTE", `no current Owner Context explains ${q.questionType}`);

  const age = derivedNum(c, ["days_late", "days_overdue", "days_since_delivery"]);
  if (age !== null) add("AGE_NOT_USED_FOR_PRIORITY", "NOTE", `Case age ${age}d recorded — not a priority input (STALE_IS_NOT_AUTOMATICALLY_URGENT)`);
  if (DEADLINE_TYPES.has(q.questionType)) add("QUALITY_BEFORE_SPEED_NOTE", "NOTE", "a passed deadline alone is not escalated (QUALITY_BEFORE_SPEED)");

  // Band rules — ordered, first match wins.
  let band: AttentionBand;
  const risk = has("RISK_CLASSIFICATION"), attention = has("ATTENTION_CLASSIFICATION");
  const label = has("OWNER_RULE_PROTECT_LABEL_RELEASES"), internal = has("OWNER_RULE_INTERNAL_DEADLINES_MATTER");
  const activeRecent = has("ACTIVE_PROJECT") && has("RECENT_ACTIVITY");
  if (has("TOO_EARLY_TO_ASK") || has("INACTIVE_PROJECT")) band = "BACKGROUND";
  else if (has("EVIDENCE_CHANGED_SINCE_ANSWER") && (risk || attention)) band = "NOW";
  else if (risk && (label || internal || activeRecent)) band = "NOW";
  else if (attention && (label || activeRecent)) band = "NOW";
  else if (risk || attention) band = "SOON";
  else band = "BACKGROUND";

  return { factors, band, answerState, activityDays, anchor: pid ? `project:${pid}` : `${c.subjectType}:${c.subjectId}` };
}

/** Builds the attention queue. Pure: never mutates its input, never reads a clock. */
export function buildAttentionQueue(input: AttentionInput): AttentionQueue {
  const policy = input.policy ?? DEFAULT_ATTENTION_POLICY;
  const lookups = { projects: input.projects ?? {}, releases: input.releases ?? {} };
  const current = new Map(resolveCurrentContexts(input.contexts ?? []).map((c) => [c.questionId, c]));
  const caseById = new Map(input.cases.map((c) => [c.id, c]));

  const assessed = decideInvestigations(input.cases).flatMap((d) => {
    if (!d.question) return [];
    const c = caseById.get(d.caseId)!;
    return [{ question: d.question, ...assess(c, d.question, lookups, policy, current.get(d.question.id) ?? null) }];
  });

  const factorKey = (f: { factors: AttentionFactor[] }) => ORDER_FACTORS.map((code) => (f.factors.some((x) => x.code === code) ? 0 : 1));
  assessed.sort((a, b) => {
    if (BAND_ORDER[a.band] !== BAND_ORDER[b.band]) return BAND_ORDER[a.band] - BAND_ORDER[b.band];
    const ka = factorKey(a), kb = factorKey(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    // Recency of ACTIVITY (a relevance signal), never age of the problem. Unknown activity sorts after known.
    const aa = a.activityDays ?? Number.POSITIVE_INFINITY, ab = b.activityDays ?? Number.POSITIVE_INFINITY;
    if (aa !== ab) return aa - ab;
    return a.question.id < b.question.id ? -1 : a.question.id > b.question.id ? 1 : 0;
  });

  // Each anchor's representatives = its best `maxPerAnchor` eligible questions (by the ordering above).
  // A lower-value question on the same anchor is NEVER substituted when a representative is capped by
  // type/budget — the anchor then simply waits for a later batch (its best question comes first).
  const eligible = (a: (typeof assessed)[number]) => a.answerState !== "ANSWERED" && a.band !== "BACKGROUND";
  const representatives = new Map<string, string[]>();
  for (const a of assessed) {
    if (!eligible(a)) continue;
    const reps = representatives.get(a.anchor) ?? [];
    if (reps.length < policy.maxPerAnchor) { reps.push(a.question.id); representatives.set(a.anchor, reps); }
  }

  const recommended: AttentionItem[] = [], backlog: AttentionItem[] = [], answered: AttentionItem[] = [];
  const perType = new Map<string, number>();

  assessed.forEach((a, i) => {
    const item: AttentionItem = {
      question: a.question, anchor: a.anchor, band: a.band, factors: a.factors, answerState: a.answerState,
      attentionState: "NOT_CURRENTLY_RECOMMENDED", deferralReason: null, representedBy: null, rank: i + 1,
    };
    if (a.answerState === "ANSWERED") { item.attentionState = "ANSWERED_NOT_RESURFACED"; answered.push(item); return; }
    if (a.band === "BACKGROUND") { item.deferralReason = "BACKGROUND_BAND"; backlog.push(item); return; }
    const reps = representatives.get(a.anchor) ?? [];
    if (!reps.includes(a.question.id)) {
      item.deferralReason = "ANCHOR_ALREADY_REPRESENTED"; item.representedBy = reps[0] ?? null; backlog.push(item); return;
    }
    if ((perType.get(a.question.questionType) ?? 0) >= policy.maxPerQuestionType) { item.deferralReason = "QUESTION_TYPE_CAP"; backlog.push(item); return; }
    if (recommended.length >= policy.maxRecommended) { item.deferralReason = "BUDGET_FULL"; backlog.push(item); return; }
    item.attentionState = "RECOMMENDED";
    recommended.push(item);
    perType.set(a.question.questionType, (perType.get(a.question.questionType) ?? 0) + 1);
  });

  return { policy, recommended, backlog, answered };
}
