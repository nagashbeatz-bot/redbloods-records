/**
 * Sunny — the MIX HANDOFF evidence rule (pure, read-only), shared by the mix view (lib/partner/mix/view.ts) and the
 * operating model's ball holder (lib/partner/sunny/operating.ts), so both answer "who holds the ball" the same way.
 *
 * The ball is an EVIDENCE rule — Owner feedback (comments, pre-mix notes, recorded "send notes" instants) vs the latest
 * upload, the comparison the app's own notes reminder uses (hasNewerVersion) — never the engineer status alone.
 * A closed work is COMPLETED / CANCELLED; disagreeing evidence is CONFLICTING_EVIDENCE, never resolved here.
 * It never imports the operating model (no cycle).
 */
import type { GatewaySources } from "../gateway/core";
import type { ProjectDetailRaw } from "../projects/detail-types";
import type { SettingsState } from "../settings/types";
import { isClosedStatus, hasNewerVersion, COMPLETED_STATUS } from "../../steven-mix-reminder-pure";
import { markerStateOf } from "../../push-claims-pure";

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
export const maxIso = (xs: Array<string | null | undefined>) => xs.filter((x): x is string => !!x).sort((a, b) => Date.parse(a) - Date.parse(b)).pop() ?? null;
const STEVEN = "Steven";

export type HandoffState = "COMPLETED" | "CANCELLED" | "WAITING_ON_ENGINEER" | "WAITING_ON_OWNER" | "CONFLICTING_EVIDENCE" | "UNKNOWN";
export interface HandoffWork { id: string; projectId: string | null; engineerName: string | null; status: string | null; sentDate?: string | null }

/** Owner "Send notes" instants recorded for a work: the active reminder cycle + every cycle start embedded in a reminder claim key. */
function notesSentInstants(settings: SettingsState | null, workId: string): { active: string | null; history: string[] } {
  const rows = settings?.families["STEVEN_MIX_REMINDER_STATE"]?.rows ?? [];
  const cycle = rows.find((r) => r.key === `steven_mix_reminder_cycle:${workId}`)?.value as { cycleStartAt?: string } | undefined;
  const hist = new Set<string>();
  for (const r of rows) {
    const m = /^steven_mix_reminder_send:([^:]+):(.+):(\d+)$/.exec(r.key);
    if (m && m[1] === workId) hist.add(m[2]);
  }
  if (cycle?.cycleStartAt) hist.add(cycle.cycleStartAt);
  return { active: cycle?.cycleStartAt ?? null, history: [...hist].sort() };
}

export function engineerHandoff(src: GatewaySources, w: HandoffWork) {
  const det = ok(src.projectDetail) as ProjectDetailRaw | null;
  const settings = ok(src.settings) as SettingsState | null;
  const isSteven = w.engineerName === STEVEN;
  const versions = (det?.mixVersions?.rows ?? []).filter((v) => v.workId === w.id);
  const versionIds = new Set(versions.map((v) => v.id));
  const comments = (det?.mixComments?.rows ?? []).filter((x) => x.versionId && versionIds.has(x.versionId));
  const lineIds = new Set((det?.mixTargets?.rows ?? []).filter((t) => t.workId === w.id).map((t) => t.id));
  const preMix = (det?.mixTargetNotes?.rows ?? []).filter((n) => n.targetId && lineIds.has(n.targetId));
  const status = w.status ?? "לא נשלח";
  const closed = isClosedStatus(status);

  const lastUpload = maxIso(versions.map((v) => v.createdAt ?? v.uploadedAt));
  const notes = isSteven ? notesSentInstants(settings, w.id) : { active: null, history: [] as string[] };
  // STALE feedback (Owner-approved cycle 2026-09-27, lib/team-ball-cycle): a comment on a version that was ALREADY
  // superseded when it was written — a newer version of the same line (target) had been uploaded before it — is feedback
  // on an old round: it never hands the ball back to the engineer. Kept as evidence (staleComments), never deleted.
  const vAt = (v: (typeof versions)[number]) => Date.parse(v.createdAt ?? v.uploadedAt ?? "");
  const staleComments = comments.filter((x) => {
    const ver = versions.find((v) => v.id === x.versionId); const ct = Date.parse(x.createdAt ?? "");
    if (!ver || !Number.isFinite(ct) || !Number.isFinite(vAt(ver))) return false;
    return versions.some((o) => o.id !== ver.id && (o.targetId ?? null) === (ver.targetId ?? null) && vAt(o) > vAt(ver) && vAt(o) <= ct);
  });
  const lastComment = maxIso(comments.filter((x) => !staleComments.includes(x)).map((x) => x.createdAt));
  const lastPreMix = maxIso(preMix.map((n) => n.createdAt));
  const lastFeedback = maxIso([lastComment, lastPreMix, ...notes.history]);
  // "Send to Steven" evidence: a delivered push (status sent) or a pre-2026-09-27 marker; a FAILED claim is not "sent".
  const mixReadyMarker = isSteven ? (settings?.families["PUSH_SENT_ONCE_MARKERS"]?.rows ?? []).some((r) => r.key === `steven_mix_ready_pushed_${w.id}` && ["SENT", "RECORDED_UNVERIFIED"].includes(markerStateOf(r.value))) : false;
  const sendLog = (det?.actions?.rows ?? []).filter((a) => a.projectId && a.projectId === w.projectId && (a.recipientRole === "sound_engineer" || (a.recipientName ?? "") === w.engineerName))
    .map((a) => ({ date: a.actionDate, status: a.status, contentType: a.contentType, recipient: a.recipientName, note: "send evidence only — the status is never updated after the send" }));
  const feedbackAfterUpload = !!lastFeedback && (!lastUpload || hasNewerVersion(lastUpload, lastFeedback));
  const uploadAfterFeedback = !!lastUpload && (!lastFeedback || hasNewerVersion(lastFeedback, lastUpload));
  const sent = status !== "לא נשלח" || mixReadyMarker || sendLog.length > 0 || !!w.sentDate;
  let state: HandoffState;
  const conflicts: string[] = [];
  if (closed) state = status === COMPLETED_STATUS ? "COMPLETED" : "CANCELLED";
  else {
    if (status === "חזר" && feedbackAfterUpload) conflicts.push("status חזר (returned to the Owner) but Owner feedback is newer than the latest version");
    if (notes.active && lastUpload && hasNewerVersion(notes.active, lastUpload)) conflicts.push("an active notes-reminder cycle while a newer version is recorded");
    state = conflicts.length ? "CONFLICTING_EVIDENCE"
      : feedbackAfterUpload ? "WAITING_ON_ENGINEER"
      : uploadAfterFeedback ? "WAITING_ON_OWNER"
      : sent ? "WAITING_ON_ENGINEER" : "UNKNOWN";
  }
  const basis = closed ? `status ${status}` : conflicts.length ? conflicts.join("; ")
    : feedbackAfterUpload ? (lastUpload ? "Owner feedback after the latest version" : "Owner feedback, no version yet")
    : uploadAfterFeedback ? "a version after the latest Owner feedback (a review is not recorded)"
    : sent ? "sent to the engineer, nothing uploaded yet" : "no version, no feedback, no send evidence";
  /** true when the answer rests on upload / feedback timestamps, false when only on status / send evidence */
  const timestampEvidence = !closed && !conflicts.length && (feedbackAfterUpload || uploadAfterFeedback);
  return { state, basis, conflicts, lastUpload, lastComment, lastPreMix, lastFeedback, notes, mixReadyMarker, sendLog, feedbackAfterUpload, uploadAfterFeedback, sent, timestampEvidence, staleComments: staleComments.map((x) => ({ versionId: x.versionId, createdAt: x.createdAt })), detailRead: !!det, settingsRead: !!settings };
}
export type EngineerHandoff = ReturnType<typeof engineerHandoff>;
