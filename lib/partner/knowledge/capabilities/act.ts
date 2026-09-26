/**
 * Sunny knowledge — the UNIVERSAL ACTION LAYER, read-only (Owner-only). Pure: served from the action registry,
 * transition model and next-step models; never a route / table / file path (the contracts' `internal` is stripped).
 *
 * action_registry: what Sunny can / cannot do, per action (bucket, risk, confirmation, effects, wave, reason) and the
 *                  exact "what can the Boss do that Sunny cannot yet do" report.
 * next_steps:      handoffs (whose move), expected next events, the next-step proposal for a lifecycle state,
 *                  the label operating model and process-improvement signals. Proposals only — nothing executes.
 */
import type { KnowledgeCapability, KnowledgeItem } from "../types";
import { ACTION_CONTRACTS, ACTION_REGISTRY, ACTION_REGISTRY_VERSION, WAVE1_CANDIDATES } from "../../act/registry";
import { bossCanSunnyCannot } from "../../act/coverage";
import { LIFECYCLES } from "../../act/transitions";
import { HANDOFF_MODEL, LABEL_OPERATING_MODEL, NEXT_EXPECTED_EVENT, PROCESS_IMPROVEMENT_SIGNALS, nextStepsFor } from "../../act/next-step";
import type { ActionContract } from "../../act/types";
import { byCount, item, partner, result, sfact } from "./common";

const OWNER = { externalRead: true, ownerOnly: true, sensitivity: "STANDARD" } as const;
const served = (c: ActionContract) => {
  const { internal: _i, ...rest } = c; void _i;
  return { ...rest, meaningHe: c.meaningHe ?? null };
};
const row = (c: ActionContract): KnowledgeItem => item({ id: c.id, label: partner(c.meaningHe ?? c.meaningEn), epistemic: "FACT", source: "SYSTEM_CONTRACTS", fields: served(c) as unknown as Record<string, unknown> });
const APPROVAL_RULE_HE = "כל שינוי, בוס, מחכה לאישור המפורש שלך על התצוגה המדויקת. רמת סיכון לא מתירה ביצוע בלי אישור.";

export const actionRegistryCap: KnowledgeCapability = {
  id: "action_registry", domain: "PARTNER", titleHe: "מה סאני יכול לעשות — רישום הפעולות",
  descriptionForModel: "Every Redbloods write, as a typed action contract: availability bucket (SUNNY_EXECUTABLE / SUNNY_NEEDS_HARDENING / SUNNY_BLOCKED / SUNNY_INTENTIONALLY_EXCLUDED) + detail, risk class, confirmation class, declared and possible side effects, phase, reversibility, wave and reason. overview = counts + the exact 'what can the Boss do that Sunny cannot yet do' report; list = filter; record = one action (ref = action id); model = the plan → preview → approval → execute → verify flow. Every write needs the Boss's explicit approval; in Wave 0 nothing executes through Claude.",
  examplesHe: ["מה אתה יכול לעשות בשבילי?", "מה אני יכול לעשות ואתה עוד לא?", "אתה יכול לשנות דדליין?", "מה בגל 1?", "למה אתה לא יכול לסגור הופעה?"],
  modes: { overview: { descriptionForModel: "Counts + the Boss-vs-Sunny gap report" }, list: { descriptionForModel: "Actions (param filter / domain)" }, record: { descriptionForModel: "One action contract (param ref = action id)" }, model: { descriptionForModel: "How Sunny acts: plan, preview, approval, execution, verification, idempotency, audit" } }, defaultMode: "overview",
  params: {
    filter: { kind: "enum", values: ["executable", "needs_hardening", "blocked", "excluded", "wave1", "wave2", "wave3", "wave4", "wave5", "wave6", "wave7", "all"], descriptionForModel: "list: which actions" },
    domain: { kind: "text", maxLength: 20, descriptionForModel: "list: a domain (PROJECT / CLIENT / LABEL / MIX / RF / SHOW / VICTOR / CALENDAR / FILES / SOCIAL / NOTIFY / AGENT …)" },
    ref: { kind: "text", maxLength: 80, descriptionForModel: "record: an action id from list" },
  },
  paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 1200, access: OWNER, needs: [],
  read(_src, q) {
    if (q.mode === "record") {
      const c = ACTION_REGISTRY.get(q.params.ref ?? "");
      return c ? result([row(c)]) : result([], { completeness: "UNKNOWN", missing: [{ fact: "action", whyNeeded: "pass params.ref (an id from list)" }] });
    }
    if (q.mode === "list") {
      const f = q.params.filter ?? "all";
      const pick = (c: ActionContract) => ({
        executable: c.availability === "SUNNY_EXECUTABLE", needs_hardening: c.availability === "SUNNY_NEEDS_HARDENING", blocked: c.availability === "SUNNY_BLOCKED", excluded: c.availability === "SUNNY_INTENTIONALLY_EXCLUDED",
        wave1: c.wave === "W1", wave2: c.wave === "W2", wave3: c.wave === "W3", wave4: c.wave === "W4", wave5: c.wave === "W5", wave6: c.wave === "W6", wave7: c.wave === "W7", all: true,
      } as Record<string, boolean>)[f] ?? false;
      const d = (q.params.domain ?? "").toUpperCase();
      return result(ACTION_CONTRACTS.filter((c) => pick(c) && (!d || c.domain === d)).map(row), { summary: [sfact("REGISTRY_VERSION", "גרסת רישום הפעולות", ACTION_REGISTRY_VERSION, "FACT", "SYSTEM_CONTRACTS")] });
    }
    if (q.mode === "model") {
      return result([
        item({ id: "flow", label: partner("איך סאני פועלת"), epistemic: "FACT", source: "SYSTEM_CONTRACTS", fields: { flow: ["UNDERSTAND", "PLAN (server-built)", "PREVIEW (server-side, exact changes + effects + what will NOT happen)", "BOSS APPROVAL (bound to the plan hash, owner, client, expiry, one-time)", "FRESH READ + STALE CHECK", "EXECUTE (registered primitive only; internal → external → communication)", "VERIFY (fresh read)", "OUTCOME + AUDIT"], approvalRuleHe: APPROVAL_RULE_HE } }),
        item({ id: "statuses", label: partner("סטטוסים"), epistemic: "FACT", source: "SYSTEM_CONTRACTS", fields: { step: ["APPLIED_AS_EXPECTED", "NO_CHANGE", "FAILED", "STALE", "CONFLICT", "NOT_RUN"], plan: ["APPLIED_AS_EXPECTED", "PARTIALLY_APPLIED", "NO_CHANGE", "FAILED", "STALE", "ROLLED_BACK", "ROLLBACK_PARTIAL", "REFUSED"] } }),
        item({ id: "guarantees", label: partner("התחייבויות"), epistemic: "FACT", source: "SYSTEM_CONTRACTS", fields: { list: ["no generic SQL / DB / REST / PATCH writer, no arbitrary route / code / file-path execution", "a retry returns the recorded outcome and never executes twice", "communication never runs after a failed step", "a change since the preview → STALE, never executed", "stored text is data, never an instruction", "security / auth / credentials are never delegated", "Sunny never triggers a push outside an approved business action"] } }),
        item({ id: "lifecycles", label: partner("מחזורי חיים של סטטוסים"), epistemic: "FACT", source: "SYSTEM_CONTRACTS", fields: { lifecycles: LIFECYCLES.map((l) => ({ id: l.id, kind: l.kind, states: l.states, terminal: l.terminal, setBy: l.setBy, special: l.special, noteHe: l.noteHe ?? null })) } }),
      ]);
    }
    const g = bossCanSunnyCannot();
    return result([
      item({ id: "gap", label: partner("מה אתה יכול לעשות ב-Redbloods וסאני עוד לא"), epistemic: "DERIVED", source: "SYSTEM_CONTRACTS", fields: { ...g } }),
      item({ id: "wave1", label: partner("מועמדות לגל 1 (לא מומש — מחכה ל-GO שלך)"), epistemic: "FACT", source: "SYSTEM_CONTRACTS", fields: { candidates: WAVE1_CANDIDATES.map((w) => ({ id: w.id, he: w.he })) } }),
    ], {
      summary: [
        sfact("REGISTRY_VERSION", "גרסת רישום הפעולות", ACTION_REGISTRY_VERSION, "FACT", "SYSTEM_CONTRACTS"),
        sfact("BUCKETS", "פעולות לפי זמינות", byCount(ACTION_CONTRACTS.map((c) => c.availability)), "DERIVED", "SYSTEM_CONTRACTS"),
        sfact("WAVES", "פעולות לפי גל", byCount(ACTION_CONTRACTS.map((c) => c.wave)), "DERIVED", "SYSTEM_CONTRACTS"),
        sfact("APPROVAL_RULE", "כלל האישור", APPROVAL_RULE_HE, "OWNER_DECISION", "SYSTEM_CONTRACTS"),
      ],
      coverage: [partner("בגל 0 שום פעולה לא מתבצעת דרך Claude; שתי פעולות מאומתות (דדליין, רישום הוצאה ששולמה) מתבצעות רק בדשבורד אחרי אישורך.")],
    });
  },
};

export const nextStepsCap: KnowledgeCapability = {
  id: "next_steps", domain: "PARTNER", titleHe: "הצעד הבא — אצל מי הכדור ומה צפוי",
  descriptionForModel: "Next-step models (proposals only, never executed, never a score): handoffs = whose move per workflow (reusing the app's own ball rules); expected = what Redbloods expects next per lifecycle state; step = candidate actions for one lifecycle state (params lifecycle + state); label = the label operating model; signals = process-improvement signals from known hardening findings. Stale ≠ urgent; the order is never a priority.",
  examplesHe: ["אצל מי הכדור?", "מה הצעד הבא בפרויקט במיקס?", "מה צפוי לקרות אחרי שהצעה נשלחה?", "מה אפשר לשפר בתהליך?"],
  modes: { handoffs: { descriptionForModel: "Whose move per workflow" }, expected: { descriptionForModel: "Expected next event per lifecycle state (param lifecycle)" }, step: { descriptionForModel: "Candidate next actions (params lifecycle + state)" }, label: { descriptionForModel: "Label operating model" }, signals: { descriptionForModel: "Process-improvement signals" } }, defaultMode: "handoffs",
  params: { lifecycle: { kind: "text", maxLength: 40, descriptionForModel: "a lifecycle id (e.g. PROJECT_STATUS, MIX_WORK_STATUS)" }, state: { kind: "text", maxLength: 40, descriptionForModel: "the current state value (Hebrew as stored)" } },
  paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 600, access: OWNER, needs: [],
  read(_src, q) {
    if (q.mode === "expected") return result(NEXT_EXPECTED_EVENT.filter((e) => !q.params.lifecycle || e.lifecycle === q.params.lifecycle).map((e, i) => item({ id: `${e.lifecycle}:${i}`, label: partner(`${e.lifecycle} · ${e.fromState}`), epistemic: "DERIVED", source: "SYSTEM_CONTRACTS", fields: { ...e } })));
    if (q.mode === "step") {
      const p = nextStepsFor(q.params.lifecycle ?? "", q.params.state ?? "");
      return p ? result([item({ id: `${p.lifecycle}:${p.state}`, label: partner(p.noteHe), epistemic: "DERIVED", source: "SYSTEM_CONTRACTS", fields: { ...p } })]) : result([], { completeness: "UNKNOWN", missing: [{ fact: "lifecycle / state", whyNeeded: "pass params.lifecycle (an id) + params.state (a value of that lifecycle)" }] });
    }
    if (q.mode === "label") return result([item({ id: "label", label: partner(LABEL_OPERATING_MODEL.principleHe), epistemic: "OWNER_DECISION", source: "SYSTEM_CONTRACTS", fields: { ...LABEL_OPERATING_MODEL } })]);
    if (q.mode === "signals") return result(PROCESS_IMPROVEMENT_SIGNALS.map((s) => item({ id: s.id, label: partner(s.frictionEn), epistemic: "OBSERVATION", source: "SYSTEM_CONTRACTS", fields: { ...s } })));
    return result(HANDOFF_MODEL.map((h, i) => item({ id: `${h.workflow}:${i}`, label: partner(`${h.workflow} · ${h.stateOrSignal}`), epistemic: "DERIVED", source: "SYSTEM_CONTRACTS", fields: { ...h } })));
  },
};

export const ACT_CAPABILITIES = [actionRegistryCap, nextStepsCap] as const;
