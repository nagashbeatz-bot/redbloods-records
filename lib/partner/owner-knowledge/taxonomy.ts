/**
 * Sunny knowledge infrastructure — the controlled vocabularies of the generic knowledge model. Pure, no imports.
 *
 *   BUSINESS_AREAS        ONE source of truth for the areas policies / frictions belong to (SOCIAL here is a knowledge /
 *                         policy area only — there is no Social feature behind it).
 *   RELATION_TYPES        what ENTITY_RELATIONSHIP can say. The first four are LEGACY (stored before 2026-10-01) and stay
 *                         readable exactly as before.
 *   CLASSIFICATION_TYPES  what ENTITY_CLASSIFICATION can say, each with its own controlled value registry. A new VALUE is a
 *                         registry entry — never a new knowledge kind.
 *   SOURCE_TYPES / CONFIDENCES / TIME_STATUSES   provenance + time-awareness stored INSIDE the typed `value`.
 */
export const BUSINESS_AREAS = ["PROJECTS", "SHOWS", "FINANCE", "RELEASES", "TEAM", "CLIENTS", "SOCIAL", "MARKETING", "CONTENT", "OPERATIONS"] as const;
export type BusinessArea = (typeof BUSINESS_AREAS)[number];
export const BUSINESS_AREA_HE: Record<BusinessArea, string> = {
  PROJECTS: "פרויקטים", SHOWS: "הופעות", FINANCE: "כספים", RELEASES: "ריליסים", TEAM: "צוות", CLIENTS: "לקוחות",
  SOCIAL: "סושיאל", MARKETING: "שיווק", CONTENT: "תוכן", OPERATIONS: "תפעול",
};

export const LEGACY_RELATION_TYPES = ["PARTICIPATES_IN_SHOWS", "WORKS_WITH", "REPRESENTS", "COLLABORATES_WITH"] as const;
export const RELATION_TYPES = [...LEGACY_RELATION_TYPES, "OWNER_OF", "FOUNDER_OF", "LABEL_ARTIST_OF", "PRODUCER_FOR", "MANAGES"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];
export const RELATION_HE: Record<RelationType, string> = {
  PARTICIPATES_IN_SHOWS: "משתתף בהופעות", WORKS_WITH: "עובד עם", REPRESENTS: "מייצג את", COLLABORATES_WITH: "משתף פעולה עם",
  OWNER_OF: "הבעלים של", FOUNDER_OF: "המייסד של", LABEL_ARTIST_OF: "אמן/ית לייבל של", PRODUCER_FOR: "מפיק/ה עבור", MANAGES: "מנהל/ת את",
};

export const CLASSIFICATION_REGISTRY = {
  RELEASE_TYPE: { titleHe: "סוג ריליס", values: { SINGLE: "סינגל", EP: "EP", ALBUM: "אלבום", NEW_VERSION: "גרסה חדשה", REMIX: "רמיקס", FEATURE: "פיצ׳ר", COMPILATION: "אוסף" } },
  PROJECT_TYPE: { titleHe: "סוג פרויקט", values: { SONG: "שיר", CLIP: "קליפ", ALBUM: "אלבום", MIX_MASTER: "מיקס / מאסטר", PRODUCTION: "הפקה", CLIENT_SERVICE: "שירות ללקוח", LABEL_RELEASE_WORK: "עבודת ריליס לייבל" } },
  CHANNEL_PURPOSE: { titleHe: "ייעוד ערוץ", values: { LABEL_MAIN: "ערוץ הלייבל הראשי", ARTIST_PERSONAL: "ערוץ אישי של אמן", BEHIND_THE_SCENES: "מאחורי הקלעים", CLIPS_ARCHIVE: "ארכיון קליפים", CONTENT_SERIES: "סדרות תוכן", SHOWS_AND_LIVE: "הופעות ולייב" } },
  CONTENT_SERIES: { titleHe: "סדרת תוכן", values: { RED_BARS: "Red Bars" } },
  CATALOG_POSITION: { titleHe: "מיקום בקטלוג", values: { FLAGSHIP: "דגל", CORE: "ליבה", SUPPORTING: "תומך", ARCHIVE: "ארכיון" } },
} as const satisfies Record<string, { titleHe: string; values: Record<string, string> }>;
export type ClassificationType = keyof typeof CLASSIFICATION_REGISTRY;
export const CLASSIFICATION_TYPES = Object.keys(CLASSIFICATION_REGISTRY) as ClassificationType[];
export const CLASSIFICATION_VALUE_HE: Record<string, string> = Object.assign({}, ...CLASSIFICATION_TYPES.map((t) => CLASSIFICATION_REGISTRY[t].values));
export const ALL_CLASSIFICATION_VALUES: readonly string[] = [...new Set(CLASSIFICATION_TYPES.flatMap((t) => Object.keys(CLASSIFICATION_REGISTRY[t].values)))];
export const classificationValueAllowed = (type: string, value: string): boolean =>
  (CLASSIFICATION_TYPES as readonly string[]).includes(type) && Object.prototype.hasOwnProperty.call(CLASSIFICATION_REGISTRY[type as ClassificationType].values, value);

export const SOURCE_TYPES = ["OWNER_STATEMENT", "SYSTEM_RECORD", "EXTERNAL_SOURCE", "INFERRED"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export const SOURCE_TYPE_HE: Record<SourceType, string> = { OWNER_STATEMENT: "הבעלים אמר במפורש", SYSTEM_RECORD: "רשומה קנונית של Redbloods", EXTERNAL_SOURCE: "מקור חיצוני", INFERRED: "הסקה של סאני" };
export const CONFIDENCES = ["CONFIRMED", "HIGH", "MEDIUM", "LOW"] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export const TIME_STATUSES = ["ACTIVE", "ENDED", "HISTORICAL"] as const;
export type TimeStatus = (typeof TIME_STATUSES)[number];
export const TIME_STATUS_HE: Record<TimeStatus, string> = { ACTIVE: "פעיל", ENDED: "הסתיים", HISTORICAL: "היסטורי" };

/** Confidence a source type carries when nobody stated one. */
export const DEFAULT_CONFIDENCE: Record<SourceType, Confidence> = { OWNER_STATEMENT: "CONFIRMED", SYSTEM_RECORD: "HIGH", EXTERNAL_SOURCE: "MEDIUM", INFERRED: "LOW" };
