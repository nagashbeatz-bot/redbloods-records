import type { SocialCampaign, SocialContentItem } from "./types";

export function getRecommendations(campaign: SocialCampaign, items: SocialContentItem[]): string[] {
  const recs: string[] = [];
  const activeItems = items.filter((i) => i.status !== "cancelled");

  // פרטי קמפיין חסרים
  if (!campaign.marketing_angle) recs.push("הגדר זווית שיווקית — מה הייחוד של השיר הזה?");
  if (!campaign.main_message) recs.push("הגדר מסר מרכזי — מה תרגיש מי שיראה את התכנים?");
  if (!campaign.target_audience) recs.push("הגדר קהל יעד — לאיזה קהל מכוון השיר?");
  if (campaign.platforms.length === 0) recs.push("בחר פלטפורמות לקמפיין (TikTok, Instagram, YouTube...)");

  // תכנים
  if (activeItems.length === 0) {
    recs.push("הוסף תכנים לקמפיין — לפחות טיזר, BTS ופוסט הכרזה");
    return recs;
  }

  const hasTikTok = activeItems.some((i) => i.platform === "tiktok");
  const hasInstagram = activeItems.some((i) => i.platform === "instagram");
  if (!hasTikTok && campaign.platforms.includes("tiktok")) {
    recs.push("אין תכנים מוקצים ל-TikTok — הוסף לפחות ריל/ליפסינק");
  }
  if (!hasInstagram && campaign.platforms.includes("instagram")) {
    recs.push("אין תכנים מוקצים ל-Instagram — הוסף פוסט הכרזה או סטורי");
  }

  const withoutOwner = activeItems.filter((i) => !i.owner_name);
  if (withoutOwner.length > 0) {
    recs.push(`${withoutOwner.length} תכנים ללא אחראי — הקצה אחראי לכל תוכן`);
  }

  const withoutDate = activeItems.filter((i) => !i.due_date && i.status !== "posted");
  if (withoutDate.length > 0) {
    recs.push(`${withoutDate.length} תכנים ללא תאריך יעד — הגדר תאריכים לכל התכנים`);
  }

  const idleItems = activeItems.filter((i) => i.status === "idea");
  if (idleItems.length > 2) {
    recs.push(`${idleItems.length} תכנים עדיין ב"רעיון" — קדם אותם לשלב הצילום`);
  }

  if (campaign.release_date) {
    const daysToRelease = Math.ceil(
      (new Date(campaign.release_date).getTime() - Date.now()) / 86400000
    );
    if (daysToRelease > 0 && daysToRelease <= 7) {
      const readyCount = activeItems.filter((i) => i.status === "ready" || i.status === "scheduled").length;
      if (readyCount < 2) {
        recs.push(`יציאה בעוד ${daysToRelease} ימים — צריך לפחות 2 תכנים מוכנים`);
      }
    }
  }

  return recs;
}
