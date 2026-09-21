/**
 * Priority tiers (P0..P3) — PURE and deterministic. Facts and config only:
 * an LLM never sets, changes or reorders a tier. All numbers come from config.ts
 * (provisional — to be tuned with the owner after a shadow run).
 */
import type { CooConfig } from "./config";
import type { Case, Signal, Tier } from "./types";
import { TIER_ORDER, betterTier, tierRank } from "./signals";

/** Tier of a Case from its signals: best signal, +promotion for several independent primaries, −cap for supporting-only. */
export function resolveCaseTier(signals: Signal[], cfg: CooConfig): { tier: Tier; reasons: string[] } {
  let tier: Tier = signals.reduce<Tier>((acc, s) => betterTier(acc, s.tier), "P3");
  const reasons: string[] = [];
  const lead = [...signals].sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || b.sort - a.sort)[0];
  if (lead) reasons.push(`הסיגנל המוביל: ${lead.type} → ${lead.tier}`);

  // independent primaries: deadline-type signals of the same case are one family (a project date and its work's date are the same fact)
  const primaryTypes = new Set(signals.filter((s) => s.role === "primary").map((s) => (cfg.caseRules.deadlineFamily.includes(s.type) ? "deadline-family" : s.type)));
  if (primaryTypes.size === 0) {
    const cap = cfg.caseRules.supportingOnlyCap;
    if (tierRank(tier) < tierRank(cap)) { tier = cap; reasons.push(`רק סיגנלים תומכים — מוגבל ל-${cap} (config)`); }
    else reasons.push("רק סיגנלים תומכים (אין סיגנל ראשי)");
  } else if (primaryTypes.size >= 2 && cfg.caseRules.multiPrimaryPromoteBy > 0) {
    // several independent primaries make a stronger case, but promotion never creates a P0 (config.promoteNotAbove)
    const floor = tierRank(cfg.caseRules.promoteNotAbove);
    if (tierRank(tier) > floor) {
      const promoted = TIER_ORDER[Math.max(floor, tierRank(tier) - cfg.caseRules.multiPrimaryPromoteBy)];
      if (promoted !== tier) { reasons.push(`${primaryTypes.size} סיגנלים ראשיים בלתי תלויים → הועלה מ-${tier} ל-${promoted} (לא מעל ${cfg.caseRules.promoteNotAbove}, config)`); tier = promoted; }
    }
  }
  return { tier, reasons };
}

/** Deterministic ordering: tier, then facts-only sort keys, then name. */
export function compareCases(a: Case, b: Case): number {
  if (tierRank(a.tier) !== tierRank(b.tier)) return tierRank(a.tier) - tierRank(b.tier);
  for (let i = 0; i < Math.max(a.sort.length, b.sort.length); i++) {
    const d = (b.sort[i] ?? 0) - (a.sort[i] ?? 0);
    if (d !== 0) return d;
  }
  return a.title < b.title ? -1 : a.title > b.title ? 1 : a.id < b.id ? -1 : 1;
}
