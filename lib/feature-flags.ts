/**
 * Client-side feature flags.
 *
 * MAI_AI_ENABLED — temporary kill-switch for the in-app "מאי AI" agent. While
 * false: the chat panel never renders, the "סוכן AI" buttons are hidden, and no
 * agent fetch fires from page chrome (`/api/ai/chat`, `/api/agent/alerts`).
 * Flip back to true to restore the feature — the code stays intact.
 *
 * Scope: purely a UI / active-usage gate. It does NOT touch API routes, the
 * agent cron (`/api/agent/check`), Push, or the DB — those remain as-is.
 */
export const MAI_AI_ENABLED = false;
