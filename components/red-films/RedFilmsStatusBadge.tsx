"use client";

interface StatusConfig {
  color: string;
  bg:    string;
}

const STATUS_MAP: Record<string, StatusConfig> = {
  "רעיון":              { color: "#9CA3AF", bg: "rgba(156,163,175,0.1)" },
  "הצעה נשלחה":        { color: "#A78BFA", bg: "rgba(167,139,250,0.1)" },
  "ממתין לאישור":      { color: "#FCD34D", bg: "rgba(252,211,77,0.1)"  },
  "בתכנון":             { color: "#60A5FA", bg: "rgba(96,165,250,0.1)"  },
  "יום צילום נקבע":    { color: "#F472B6", bg: "rgba(244,114,182,0.1)" },
  "צולם":               { color: "#C084FC", bg: "rgba(192,132,252,0.1)" },
  "חומרי גלם הועלו":   { color: "#22D3EE", bg: "rgba(34,211,238,0.1)"  },
  "בעריכה":             { color: "#FB923C", bg: "rgba(251,146,60,0.1)"  },
  "נשלחה גרסה":        { color: "#FBBF24", bg: "rgba(251,191,36,0.1)"  },
  "תיקונים":            { color: "#F87171", bg: "rgba(248,113,113,0.1)" },
  "מאושר":              { color: "#34D399", bg: "rgba(52,211,153,0.1)"  },
  "פורסם":              { color: "#4ADE80", bg: "rgba(74,222,128,0.1)"  },
  "בוטל":               { color: "#6B7280", bg: "rgba(107,114,128,0.08)"},
};

const FALLBACK: StatusConfig = { color: "#888", bg: "rgba(136,136,136,0.1)" };

interface Props {
  status: string;
  small?: boolean;
}

export default function RedFilmsStatusBadge({ status, small = false }: Props) {
  const { color, bg } = STATUS_MAP[status] ?? FALLBACK;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: small ? 4 : 5,
        padding: small ? "2px 7px" : "3px 9px",
        borderRadius: 20,
        fontSize: small ? 10 : 11,
        fontWeight: 600,
        color,
        background: bg,
        border: `1px solid ${color}33`,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: small ? 5 : 6, height: small ? 5 : 6,
          borderRadius: "50%", background: color, flexShrink: 0,
        }}
      />
      {status}
    </span>
  );
}

/** All valid production statuses — used in dropdowns */
export const PRODUCTION_STATUSES = [
  "רעיון", "הצעה נשלחה", "ממתין לאישור", "בתכנון",
  "יום צילום נקבע", "צולם", "חומרי גלם הועלו",
  "בעריכה", "נשלחה גרסה", "תיקונים", "מאושר", "פורסם", "בוטל",
] as const;

export const PRODUCTION_TYPES = [
  "קליפ", "יום צילום", "תוכן סושיאל", "צילום הופעה",
  "צילום סטודיו", "מאחורי הקלעים", "פרסומת", "ויזואלייזר", "צילום לייב", "אחר",
] as const;

export const COLLECTION_STATUSES = [
  "לא רלוונטי", "צפוי", "התקבל", "שולם", "לא שולם", "חלקי", "בוטל",
] as const;

export const EDIT_STATUSES = [
  "לא התחיל", "חומרי גלם הועלו", "בעריכה", "נשלחה גרסה 1", "תיקונים", "מאושר", "פורסם",
] as const;

export const CLIENT_SOURCES = [
  "פנימי - לייבל", "לקוח חיצוני", "אמן לייבל", "פרויקט שיווקי", "אחר",
] as const;
