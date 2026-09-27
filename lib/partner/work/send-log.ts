/**
 * Send-log SUPERSEDE rule (B5, 2026-09-27) — pure, read-only. A send-log entry (project_actions) is a snapshot the
 * Owner wrote at send time; nothing updates it when the other side answers. So a "pending_version" entry can still
 * say "waiting for a version" long after the version arrived. This rule states whether the entry is still CURRENT
 * against LATER in-app evidence — it never edits the entry and never deletes history:
 *
 *   pending_version   SUPERSEDED when a version upload exists AFTER the entry's action date:
 *                       engineer (recipient sound_engineer)        → mix_versions.created_at of the project's works
 *                       external producer / Victor (linked work)   → the Victor work's files_sent uploadedAt
 *   pending_feedback  SUPERSEDED when a response was recorded AFTER the action date (where one is recorded, e.g. the
 *                     Owner's sent notes to Victor — reviews.sentAt); otherwise it stays CURRENT.
 *   same day          the entry has a DATE only (no time) → an upload on the same Israel day is AMBIGUOUS: the entry
 *                     is kept as evidence (treated as current), never silently superseded.
 *   anything else     NOT_PENDING (approved / closed / cancelled / got_notes / sent …).
 *
 * A superseded entry is HISTORICAL: it is not a ball holder, not a WAITING_* signal and not CONFLICTING_EVIDENCE.
 */
export type SendEntryState = "CURRENT" | "SUPERSEDED" | "AMBIGUOUS_SAME_DAY" | "NOT_PENDING";
export interface SendEntryLite { status: string | null; actionDate: string | null; recipientRole?: string | null; linkedWorkId?: string | null }
export interface LaterEvidence {
  /** ISO timestamps (or YYYY-MM-DD) of version uploads relevant to this entry's recipient. */
  versionUploads?: ReadonlyArray<string | null | undefined>;
  /** ISO timestamps (or YYYY-MM-DD) of recorded responses relevant to a pending_feedback entry. */
  responses?: ReadonlyArray<string | null | undefined>;
}

/** The Israel calendar day of an ISO timestamp (a bare YYYY-MM-DD stays as is). */
export function ilDayOf(ts: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return ts;
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}

export function sendEntryCurrent(entry: SendEntryLite, later: LaterEvidence): { state: SendEntryState; basis: string } {
  const status = entry.status ?? "";
  if (status !== "pending_version" && status !== "pending_feedback") return { state: "NOT_PENDING", basis: `status ${status || "—"}` };
  const action = entry.actionDate ? entry.actionDate.slice(0, 10) : null;
  const evidence = (status === "pending_version" ? later.versionUploads : later.responses) ?? [];
  const daysOf = evidence.map((x) => (x ? ilDayOf(x) : null)).filter((x): x is string => !!x).sort();
  const what = status === "pending_version" ? "version upload" : "recorded response";
  if (!action) return { state: "CURRENT", basis: "the entry has no action date — cannot be compared" };
  const after = daysOf.filter((d) => d > action);
  if (after.length) return { state: "SUPERSEDED", basis: `a ${what} on ${after[after.length - 1]} is after the entry (${action}) — historical` };
  if (daysOf.includes(action)) return { state: "AMBIGUOUS_SAME_DAY", basis: `a ${what} on the same day as the entry (${action}); the entry has no time — kept as evidence` };
  return { state: "CURRENT", basis: `no ${what} after ${action}` };
}

/** Still-open (CURRENT or AMBIGUOUS_SAME_DAY) = counts as waiting; SUPERSEDED / NOT_PENDING do not. */
export const isOpenSendState = (s: SendEntryState) => s === "CURRENT" || s === "AMBIGUOUS_SAME_DAY";

/** Which later evidence applies to an entry's recipient (engineer → mix versions; external producer / linked Victor work → Victor uploads). */
export function evidenceFor(entry: SendEntryLite, ev: { mixVersionCreatedAt: ReadonlyArray<string | null>; victorUploads: ReadonlyArray<string | null>; victorNotesSentAt?: ReadonlyArray<string | null> }): LaterEvidence {
  const role = entry.recipientRole ?? "";
  if (role === "sound_engineer") return { versionUploads: ev.mixVersionCreatedAt };
  if (role === "external_producer") return { versionUploads: ev.victorUploads, responses: ev.victorNotesSentAt ?? [] };
  return {};
}
