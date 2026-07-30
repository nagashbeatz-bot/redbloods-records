"use client";

/**
 * Renders plain text with any http(s):// or www. URL turned into a clickable
 * link — everything else (surrounding text, line breaks, spacing) passes
 * through exactly as given. Matches via regex + String.split only; no HTML
 * parsing, no dangerouslySetInnerHTML.
 */

const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
// Trailing punctuation that's almost never actually part of the URL (a
// sentence-ending period, a closing paren/quote wrapping the link, etc.) —
// trimmed off the link and rendered back as plain text right after it.
const TRAILING_PUNCT_RE = /[).,;:!?\]"'”’]+$/;

function hrefFor(url: string): string {
  return url.startsWith("www.") ? `https://${url}` : url;
}

export default function LinkifiedText({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  // A single capturing group makes String.split() alternate
  // [plain, match, plain, match, ...] — odd indices are always URL matches.
  const segments = text.split(URL_RE);
  return (
    <>
      {segments.map((seg, i) => {
        if (i % 2 === 0 || !seg) return seg || null;
        const trailMatch = seg.match(TRAILING_PUNCT_RE);
        const trail = trailMatch ? trailMatch[0] : "";
        const url = trail ? seg.slice(0, seg.length - trail.length) : seg;
        if (!url) return seg; // punctuation-only match — treat as plain text
        return (
          <span key={i}>
            <a
              href={hrefFor(url)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ color: "#60A5FA", textDecoration: "underline", textUnderlineOffset: 2 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#93C5FD"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#60A5FA"; }}
            >
              {url}
            </a>
            {trail}
          </span>
        );
      })}
    </>
  );
}
