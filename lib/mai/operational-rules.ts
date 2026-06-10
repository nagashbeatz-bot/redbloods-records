/**
 * Mai Operational Layer — pure rule checks.
 *
 * Constraints:
 *   - No fetch, no Supabase, no mutation, no AI, no side effects.
 *   - All functions are pure: data in → findings out.
 *   - Safe to call on every render from any client component.
 */

import type { Proposal, ProposalStatus } from "@/components/clients/ProposalsSection";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProposalFinding {
  proposalId:    string;
  title:         string;
  amount:        number;
  currency:      string;
  status:        ProposalStatus;
  followup_date: string;   // YYYY-MM-DD
  overdueDays:   number;   // 0 = today, >0 = N days overdue
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Statuses where a follow-up reminder makes sense.
 * "נסגר" and "לא נסגר" are terminal — skip them.
 */
const ACTIVE_PROPOSAL_STATUSES = new Set<ProposalStatus>([
  "הצעה נשלחה",
  "ממתין לתשובה",
  "צריך פולואפ",
  "לחזור בעתיד",
]);

// ── checkProposalFollowUps ────────────────────────────────────────────────────

/**
 * Returns proposals that need follow-up:
 *   - Status is "active" (not נסגר / לא נסגר)
 *   - followup_date exists and is today or in the past
 *
 * Sorted: most overdue first.
 */
export function checkProposalFollowUps(proposals: Proposal[]): ProposalFinding[] {
  const today = new Date().toISOString().split("T")[0];

  const findings: ProposalFinding[] = [];

  for (const p of proposals) {
    if (!p.followup_date) continue;
    if (!ACTIVE_PROPOSAL_STATUSES.has(p.status)) continue;
    if (p.followup_date > today) continue;

    const msPerDay    = 86_400_000;
    const overdueDays = Math.round(
      (new Date(today).getTime() - new Date(p.followup_date).getTime()) / msPerDay
    );

    findings.push({
      proposalId:    p.id,
      title:         p.title,
      amount:        p.amount,
      currency:      p.currency,
      status:        p.status,
      followup_date: p.followup_date,
      overdueDays,
    });
  }

  // Most overdue first
  findings.sort((a, b) => b.overdueDays - a.overdueDays);

  return findings;
}
