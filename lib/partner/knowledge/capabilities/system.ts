/**
 * Sunny knowledge — SYSTEM AWARENESS: what Redbloods OS is, how it works, and what Sunny can / cannot do in it.
 * Served from the typed system contracts (lib/partner/system) — never from prompt assumptions. READ-ONLY, static per
 * deploy (versioned by SYSTEM_BASELINE_VERSION + the capability change log).
 */
import { BUSINESS_ACTIONS, CAPABILITY_CHANGES, coverageMatrix, DOMAIN_CONTRACTS, RELATIONSHIPS, servedDomain, SYSTEM_BASELINE_VERSION } from "../../system";
import type { KnowledgeCapability } from "../types";
import { byCount, item, partner, result, sfact } from "./common";

const DOMAIN_IDS = DOMAIN_CONTRACTS.map((d) => d.id);
const SRC = "SYSTEM_CONTRACTS" as const;
const version = () => sfact("BASELINE_VERSION", "גרסת הידע על המערכת", SYSTEM_BASELINE_VERSION, "FACT", SRC);
const LAYERS = [
  "1 מצב החברה החי (פרויקטים, כספים, הופעות…) — נקרא ישירות מ-Redbloods.",
  "2 הידע על המערכת (איך Redbloods עובדת, כללים, קשרים, מה סאני יכול לעשות) — היכולת הזו.",
  "3 ידע ארגוני מהבעלים (כינויים, סיבות, עדיפויות) — owner_knowledge.",
];

export const systemAwareness: KnowledgeCapability = {
  id: "system_awareness", domain: "PARTNER", titleHe: "מה סאני יודע על Redbloods",
  descriptionForModel: "How Redbloods OS works and what Sunny can do in it, from the typed system contracts (not assumptions). Use for 'what do you know about shows?', 'can you create a show?', 'calendar access?', 'can you send push?', 'what can't you do?'. Modes: overview (domains + read/learn/propose/execute support), domain (purpose, canonical source, rules, side effects, notifications, limitations), rules (CONFLICT / POSSIBLE_BUG are reported problems, NOT policy), relationships (entity graph + relation quality), actions (every business mutation and whether Sunny may propose it), limitations, changes (capability change log), coverage. Execution by Sunny is unavailable everywhere; approvals happen in the Redbloods dashboard.",
  examplesHe: ["מה אתה יודע על מערכת ההופעות?", "אתה יכול ליצור הופעה?", "יש לך גישה ליומן?", "אתה יכול לשלוח Push?", "מה אתה יודע על העמוד של שליו?", "מה אתה לא יכול לעשות?", "מה חסר לך כדי לנהל את החברה?"],
  modes: {
    overview: { descriptionForModel: "Every domain + support summary" }, domain: { descriptionForModel: "One domain in full (param domain)" },
    rules: { descriptionForModel: "Business rules (optional domain / class)" }, relationships: { descriptionForModel: "Entity graph with relation quality" },
    actions: { descriptionForModel: "Business action map (optional domain)" }, limitations: { descriptionForModel: "What Sunny cannot see / do" },
    changes: { descriptionForModel: "Capability change log" }, coverage: { descriptionForModel: "READ / LEARN / PROPOSE / EXECUTE matrix" },
  },
  defaultMode: "overview",
  params: {
    domain: { kind: "enum", values: DOMAIN_IDS, descriptionForModel: "A system domain id (see overview)" },
    class: { kind: "enum", values: ["CANONICAL_BUSINESS_RULE", "IMPLEMENTATION_BEHAVIOR", "OWNER_POLICY", "LEGACY_BEHAVIOR", "POSSIBLE_BUG", "CONFLICT"], descriptionForModel: "Only rules of this class" },
  },
  paging: { defaultLimit: 40, maxLimit: 50 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: [],
  read(_src, q) {
    const pick = q.params.domain ? DOMAIN_CONTRACTS.filter((d) => d.id === q.params.domain) : DOMAIN_CONTRACTS;
    const base = { summary: [version()], coverage: LAYERS.map((l) => partner(l)) };
    if (q.mode === "domain") {
      if (!q.params.domain) return result([], { ...base, completeness: "UNKNOWN", missing: [{ fact: "domain", whyNeeded: "pass params.domain (see mode overview)" }] });
      return result(pick.map((d) => item({ id: d.id, label: partner(d.titleHe), epistemic: "FACT", source: SRC, fields: servedDomain(d) as unknown as Record<string, unknown> })), base);
    }
    if (q.mode === "rules") {
      const rules = pick.flatMap((d) => d.rules.map((r) => ({ d, r }))).filter(({ r }) => !q.params.class || r.class === q.params.class);
      return result(rules.map(({ d, r }) => item({ id: `${d.id}:${r.id}`, label: partner(r.text), epistemic: r.class === "CONFLICT" || r.class === "POSSIBLE_BUG" ? "OBSERVATION" : "FACT", source: SRC,
        fields: { domain: d.id, rule: r.id, class: r.class, touches: r.touches ?? [], policy: r.class === "CANONICAL_BUSINESS_RULE" || r.class === "OWNER_POLICY" } })),
        { ...base, summary: [version(), sfact("BY_CLASS", "כללים לפי סיווג", byCount(rules.map(({ r }) => r.class)), "FACT", SRC)] });
    }
    if (q.mode === "relationships") {
      return result(RELATIONSHIPS.map((r, i) => item({ id: `rel:${i}`, label: partner(`${r.from} ↔ ${r.to}`), epistemic: "FACT", source: SRC, fields: { via: r.via, quality: r.quality, note: r.note ?? null } })),
        { ...base, summary: [version(), sfact("BY_QUALITY", "קשרים לפי איכות", byCount(RELATIONSHIPS.map((r) => r.quality)), "FACT", SRC)] });
    }
    if (q.mode === "actions") {
      const acts = BUSINESS_ACTIONS.filter((a) => !q.params.domain || a.domain === q.params.domain);
      return result(acts.map((a) => item({ id: a.id, label: partner(a.meaning), epistemic: "FACT", source: SRC, fields: { domain: a.domain, class: a.class, approval: a.approval, financialRisk: a.financialRisk, externalRisk: a.externalRisk, primitive: a.primitive ?? null, reason: a.reason } })),
        { ...base, summary: [version(), sfact("BY_CLASS", "פעולות לפי סיווג", byCount(acts.map((a) => a.class)), "FACT", SRC)] });
    }
    if (q.mode === "limitations") {
      return result(pick.flatMap((d) => d.limitationsHe.map((l, i) => item({ id: `${d.id}:${i}`, label: partner(l), epistemic: "FACT", source: SRC, fields: { domain: d.id, states: [...d.states] } }))), base);
    }
    if (q.mode === "changes") {
      return result([...CAPABILITY_CHANGES].reverse().map((c, i) => item({ id: `${c.version}:${c.domain}:${c.dimension}:${i}`, label: partner(c.noteHe), epistemic: "FACT", source: SRC, fields: { ...c } })), base);
    }
    const rows = q.mode === "coverage" ? coverageMatrix().filter((r) => !q.params.domain || r.domain === q.params.domain) : coverageMatrix().filter((r) => !q.params.domain || r.domain === q.params.domain);
    return result(rows.map((r) => item({ id: r.domain, label: partner(r.title), epistemic: "FACT", source: SRC, fields: { group: r.group, read: r.read, learn: r.learn, propose: r.propose, execute: r.execute, states: r.states,
      ...(q.mode === "overview" ? { purpose: DOMAIN_CONTRACTS.find((d) => d.id === r.domain)!.purpose, readCapabilities: [...DOMAIN_CONTRACTS.find((d) => d.id === r.domain)!.readCapabilities] } : {}) } })),
      { ...base, summary: [version(), sfact("READ_SUPPORT", "תמיכת קריאה", byCount(rows.map((r) => r.read)), "FACT", SRC)] });
  },
};
