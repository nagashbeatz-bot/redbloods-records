/**
 * Feature flags.
 *
 * AGENT_ALERT_RULES_ENABLED — the old rule-based agent-alert pipeline stays switched off, exactly as before:
 * the 13 alert rules, their alert pushes and report triggers (the agent check route), the alert list / badge /
 * summary widgets and alert updates. The deterministic holiday alerts and the week-strength alert run regardless.
 * This flag never enables any AI: the retired in-app AI assistant was removed from the product on 2026-09-25.
 */
export const AGENT_ALERT_RULES_ENABLED = false;
