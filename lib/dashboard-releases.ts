// Pure, client-safe derivation for the dashboard's "ריליסים קרובים" card and its
// header chips. Reads the rows GET /api/label/releases already returns
// (listLabelReleases → NO date filtering) and never writes anything.
//
// Display-only mapping: the 12 release_stage values stay exactly as they are in the
// DB and in /label — the four dashboard statuses are just a grouping of them.

import type { LabelRelease, ProjectReleaseDetails, ReleaseStage } from "./types";
import { ilTodayYMD } from "./red-artists/week";

export type ReleaseDisplayStatus = "בעבודה" | "בהכנה לריליס" | "מתוזמן";

// "יצא" and "בהשהייה" are deliberately absent → those releases are not shown.
const DISPLAY_STATUS: Partial<Record<ReleaseStage, ReleaseDisplayStatus>> = {
  "רעיון": "בעבודה", "הפקה": "בעבודה", "הקלטה": "בעבודה",
  "עריכות": "בעבודה", "מיקס": "בעבודה", "מאסטר": "בעבודה",
  "עטיפה": "בהכנה לריליס", "הפצה": "בהכנה לריליס", "תוכן": "בהכנה לריליס",
  "מוכן ליציאה": "מתוזמן",
};

export function releaseDisplayStatus(stage: ReleaseStage): ReleaseDisplayStatus | null {
  return DISPLAY_STATUS[stage] ?? null;
}

export type ReleaseLineKind = "missing" | "next" | "ready";

export interface UpcomingReleaseRow {
  item: LabelRelease & { release: ProjectReleaseDetails };
  status: ReleaseDisplayStatus;
  /** Whole days until the release date; negative = the date already passed. */
  daysLeft: number;
  overdue: boolean;
  /** blocker set, OR date passed while the release is not "יצא". */
  needsAttention: boolean;
  line: { kind: ReleaseLineKind; text: string } | null;
}

export interface UpcomingReleases {
  /** Every qualifying release, soonest date first (overdue ones therefore lead). */
  rows: UpcomingReleaseRow[];
  needsAttentionCount: number;
}

/** Whole calendar days from one YYYY-MM-DD to another (DST-proof, UTC arithmetic). */
function dayDiff(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function summarizeUpcomingReleases(
  releases: LabelRelease[],
  today: string = ilTodayYMD(),
): UpcomingReleases {
  const rows: UpcomingReleaseRow[] = [];

  for (const item of releases) {
    const rel = item.release;
    if (!rel || !rel.releaseTargetDate) continue;
    const status = releaseDisplayStatus(rel.releaseStage);
    if (!status) continue; // יצא / בהשהייה / unknown stage

    const daysLeft = dayDiff(today, rel.releaseTargetDate);
    const overdue = daysLeft < 0;
    const blocker = rel.blocker.trim();
    const nextAction = rel.nextAction.trim();

    let line: UpcomingReleaseRow["line"] = null;
    if (blocker) line = { kind: "missing", text: `חסר: ${blocker}` };
    else if (nextAction) line = { kind: "next", text: `הבא: ${nextAction}` };
    else if (rel.releaseStage === "מוכן ליציאה") line = { kind: "ready", text: "הכל מוכן" };

    rows.push({
      item: item as UpcomingReleaseRow["item"],
      status, daysLeft, overdue,
      needsAttention: !!blocker || overdue,
      line,
    });
  }

  rows.sort((a, b) => a.daysLeft - b.daysLeft || a.item.name.localeCompare(b.item.name, "he"));
  return { rows, needsAttentionCount: rows.filter((r) => r.needsAttention).length };
}

/** "עוד 8 ימים" / "מחר" / "היום" / "עבר התאריך ב-3 ימים". */
export function releaseDaysText(daysLeft: number): string {
  if (daysLeft < 0) {
    const n = -daysLeft;
    return n === 1 ? "עבר התאריך אתמול" : `עבר התאריך ב-${n} ימים`;
  }
  if (daysLeft === 0) return "היום";
  if (daysLeft === 1) return "מחר";
  return `עוד ${daysLeft} ימים`;
}

/** YYYY-MM-DD → DD.MM.YY (as in the mockup). */
export function releaseShortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}.${m}.${y.slice(-2)}`;
}
