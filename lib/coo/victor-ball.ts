/**
 * Who holds the ball on a Victor work — PURE and deterministic.
 *
 * Source of truth = two existing timestamps only:
 *   - files_sent[].uploadedAt          → Victor delivered a version
 *   - version_reviews[].sentAt         → the owner sent notes / a revision request to Victor
 * NOT used: files_received (always empty), returned_date (a completion stamp), version_reviews.status
 * (always "waiting") and work_state on its own (it stays "נשלח לויקטור" after uploads).
 *
 *   owner  : the latest RECORDED action is Victor's upload — it is later than the owner's last notes, or there are no notes after it.
 *            (An internal workflow state, NOT a claim that the owner still has to review: he may have handled it outside the system.)
 *   victor : the owner's last notes are later than Victor's last upload.
 *   unknown: not enough reliable timestamps, or the comparison is ambiguous (never guessed).
 *
 * Comparison uses the FULL timestamp (not the date). Two timestamps closer than the tolerance are
 * ambiguous → unknown.
 *
 * STALE FEEDBACK (Owner-approved cycle, 2026-09-27): version → Owner's ball; Owner feedback → Victor's ball; a new version
 * → Owner's ball again. Notes sent on a version that was ALREADY SUPERSEDED when they were sent (a newer version of another
 * key had been uploaded before the notes) are feedback on an old round: they never hand the ball back to Victor. Applied
 * only when the version keys are known (uploadVersions + reviewVersions); an unknown key is never treated as stale.
 */
import type { CooConfig } from "./config";
import type { RawVictorWork, VictorBall } from "./types";
import { fullDate, ilTime, ilYmd } from "./dates";

const ts = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};
const stamp = (t: number) => `${fullDate(ilYmd(new Date(t)))} ${ilTime(new Date(t))}`;

export interface VictorBallResult { ball: VictorBall; lastUploadAt: string | null; lastNotesSentAt: string | null; staleFeedback?: Array<{ versionKey: string; sentAt: string; supersededBy: string }> }

/** The version GROUP key of a Victor file — the SAME rule as VictorProfilePage / lib/writes/victor (stored V-label, else the filename). */
export function victorVersionKeyOf(f: { versionLabel?: string | null; name?: string | null }): string | null {
  if (f.versionLabel && /^V\d+$/i.test(f.versionLabel)) return f.versionLabel.toUpperCase();
  const n = (f.name ?? "").toLowerCase();
  const m = n.match(/\bv[\s._-]?(\d{1,3})\b/) || n.match(/version[\s._-]?(\d{1,3})/) || n.match(/מיקס[\s._-]?(\d{1,3})/);
  if (m) return `V${Number(m[1])}`;
  if (/\bfinal\b|פיינל/.test(n)) return "FINAL";
  if (/\bfix\b/.test(n)) return "FIX";
  return null;
}

/** Notes sent on a version already superseded (another version key uploaded after it and before the notes). Pure. */
export function staleVictorFeedback(uploadVersions: ReadonlyArray<{ at: string | null; versionKey: string | null }>, reviewVersions: ReadonlyArray<{ versionKey: string; sentAt: string | null; draft: boolean }>): Array<{ versionKey: string; sentAt: string; supersededBy: string }> {
  const lastOf = new Map<string, number>(), firstOf = new Map<string, number>();
  for (const u of uploadVersions) {
    const t = ts(u.at); const k = u.versionKey?.toUpperCase() ?? null;
    if (t === null || !k) continue;
    lastOf.set(k, Math.max(lastOf.get(k) ?? t, t)); firstOf.set(k, Math.min(firstOf.get(k) ?? t, t));
  }
  const out: Array<{ versionKey: string; sentAt: string; supersededBy: string }> = [];
  for (const r of reviewVersions) {
    const k = r.versionKey.toUpperCase(); const sent = ts(r.sentAt);
    if (r.draft || sent === null || !lastOf.has(k)) continue; // unknown key / never sent → never stale
    const newer = [...firstOf.entries()].find(([j, first]) => j !== k && first > lastOf.get(k)! && first <= sent);
    if (newer) out.push({ versionKey: k, sentAt: r.sentAt!, supersededBy: newer[0] });
  }
  return out;
}

export function computeVictorBall(w: Pick<RawVictorWork, "uploads" | "filesWithoutTimestamp" | "reviews" | "reviewEvents" | "uploadVersions"> & { reviewVersions?: ReadonlyArray<{ versionKey: string; sentAt: string | null; draft: boolean }> }, cfg: CooConfig): VictorBallResult {
  const ups = w.uploads.map(ts).filter((t): t is number => t !== null);
  const reviewVersions = w.reviewVersions ?? w.reviewEvents;
  const stale = w.uploadVersions && reviewVersions ? staleVictorFeedback(w.uploadVersions, reviewVersions) : [];
  const staleSent = new Set(stale.map((s) => `${s.versionKey}|${s.sentAt}`));
  const sents = (w.uploadVersions && reviewVersions
    ? reviewVersions.filter((r) => !staleSent.has(`${r.versionKey.toUpperCase()}|${r.sentAt}`)).map((r) => ts(r.sentAt))
    : w.reviews.map((r) => ts(r.sentAt))).filter((t): t is number => t !== null);
  const lastUp = ups.length ? Math.max(...ups) : null;
  const lastNotes = sents.length ? Math.max(...sents) : null;
  // a review that Victor can see but whose sending time is unknown (legacy: no sentAt, not a draft)
  const legacyUnknownTime = w.reviews.filter((r) => !r.sentAt && !r.draft).length;
  const tol = cfg.victorBall.tieSeconds * 1000;

  const out = (holder: VictorBall["holder"], code: string, basis: string): VictorBallResult => ({
    ball: { holder, code, basis },
    lastUploadAt: lastUp !== null ? new Date(lastUp).toISOString() : null,
    lastNotesSentAt: lastNotes !== null ? new Date(lastNotes).toISOString() : null,
    ...(stale.length ? { staleFeedback: stale } : {}),
  });

  if (lastUp === null && lastNotes === null) {
    return out("unknown", w.filesWithoutTimestamp > 0 ? "files_without_timestamp" : "no_timestamps",
      w.filesWithoutTimestamp > 0 ? "יש קבצים אבל בלי חותמת זמן, ולא נשלחו הערות — אי אפשר לקבוע" : "Victor לא העלה כלום ולא נשלחו הערות — אין חותמות זמן לקבוע לפיהן");
  }
  if (lastUp !== null && (lastNotes === null || lastUp - lastNotes > tol)) {
    if (legacyUnknownTime > 0) return out("unknown", "legacy_review_time_unknown", "יש הערות ישנות בלי זמן שליחה — לא ידוע אם נשלחו אחרי ההעלאה האחרונה");
    return lastNotes === null
      ? out("owner", "upload_no_notes", `Victor העלה ב-${stamp(lastUp)} ולא נשלחו לו הערות מאז`)
      : out("owner", "upload_after_notes", `Victor העלה ב-${stamp(lastUp)}, אחרי ההערות האחרונות שנשלחו לו (${stamp(lastNotes)})`);
  }
  if (lastNotes !== null && (lastUp === null || lastNotes - lastUp > tol)) {
    if (w.filesWithoutTimestamp > 0) return out("unknown", "untimestamped_files_could_be_newer", "יש קבצים בלי חותמת זמן — ייתכן שהועלו אחרי ההערות האחרונות");
    return lastUp === null
      ? out("victor", "notes_no_upload", `נשלחו ל-Victor הערות ב-${stamp(lastNotes)} והוא לא העלה כלום`)
      : out("victor", "notes_after_upload", `נשלחו ל-Victor הערות ב-${stamp(lastNotes)}, אחרי ההעלאה האחרונה שלו (${stamp(lastUp)})`);
  }
  return out("unknown", "timestamps_too_close", `חותמות ההעלאה וההערות קרובות מדי כדי לקבוע סדר (פחות מ-${cfg.victorBall.tieSeconds} שניות)`);
}
