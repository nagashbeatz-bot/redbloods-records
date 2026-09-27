import type { SocialCampaign, SocialContentItem } from "./types";
import { socialPhaseOf, isSocialItemOverdue } from "./types";
import { israelTodayYmd } from "./project-deadline";

export type MissingSeverity = "urgent" | "warning" | "info";

export interface MissingItem {
  label: string;
  severity: MissingSeverity;
}

export function checkMissing(campaign: SocialCampaign, items: SocialContentItem[], todayYmd?: string): MissingItem[] {
  // B5: the shared phases (lib/types.ts) cover BOTH vocabularies — cancelled out, ready_to_post is ready, published is
  // never overdue. Today = the Israel calendar day.
  const activeItems = items.filter((i) => socialPhaseOf(i.status) !== "CANCELLED");
  const types = activeItems.map((i) => i.content_type);
  const today = todayYmd ?? israelTodayYmd();

  const daysToRelease = campaign.release_date
    ? Math.ceil((new Date(campaign.release_date).getTime() - Date.now()) / 86400000)
    : null;

  const missing: MissingItem[] = [];

  // תוכן חיוני חסר
  if (!types.includes("טיזר")) {
    missing.push({ label: "חסר טיזר פזמון", severity: daysToRelease !== null && daysToRelease <= 7 ? "urgent" : "warning" });
  }
  if (!types.includes("BTS")) {
    missing.push({ label: "חסר תוכן BTS", severity: "info" });
  }
  if (!types.includes("ליפסינק")) {
    missing.push({ label: "חסר ליפסינק לפזמון", severity: "info" });
  }
  if (!types.includes("פוסט")) {
    missing.push({ label: "חסר פוסט הכרזה", severity: "warning" });
  }

  // מוכנות להעלאה
  const hasReady = activeItems.some((i) => socialPhaseOf(i.status) === "READY");
  if (!hasReady && activeItems.length > 0) {
    missing.push({
      label: "אין תוכן מוכן להעלאה",
      severity: daysToRelease !== null && daysToRelease <= 7 ? "urgent" : "warning",
    });
  }

  // מעט תכנים קרוב ליציאה
  if (daysToRelease !== null && daysToRelease <= 14 && activeItems.length < 3) {
    missing.push({
      label: `פחות מ-3 תכנים ויציאה בעוד ${Math.max(0, daysToRelease)} ימים`,
      severity: "urgent",
    });
  }

  // תוכן מוכן ללא קישור קובץ
  const readyWithoutAsset = activeItems.filter(
    (i) => socialPhaseOf(i.status) === "READY" && !i.asset_link && !i.dropbox_link
  );
  if (readyWithoutAsset.length > 0) {
    missing.push({
      label: `${readyWithoutAsset.length} תוכן מוכן ללא קישור קובץ`,
      severity: "warning",
    });
  }

  // תוכן שעבר תאריך יעד
  const overdueItems = activeItems.filter((i) => isSocialItemOverdue(i, today));
  if (overdueItems.length > 0) {
    missing.push({
      label: `${overdueItems.length} תוכן שעבר תאריך יעד`,
      severity: "urgent",
    });
  }

  // אין תכנים בכלל
  if (activeItems.length === 0 && campaign.status === "active") {
    missing.push({ label: "הקמפיין פעיל ואין תכנים", severity: "urgent" });
  }

  return missing;
}
