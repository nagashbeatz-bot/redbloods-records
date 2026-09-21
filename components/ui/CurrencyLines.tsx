"use client";

/**
 * Additional-currency lines shown UNDER a headline ₪ number (never merged into it).
 *
 * Display-only. Each line is LTR-isolated so "$2,200" / "−$2,200" read correctly
 * inside RTL pages. Renders nothing when there are no lines, so a ₪-only surface is
 * left exactly as it was.
 */
export type CurrencyLine = { text: string; color?: string };

export default function CurrencyLines({
  lines, color, size = 12.5, align = "right", weight = 700, marginTop = 2, wrap,
}: {
  lines: CurrencyLine[];
  /** Default colour for lines that do not carry their own. */
  color: string;
  size?: number;
  align?: "left" | "right";
  weight?: number;
  marginTop?: number;
  /** Optional wrapper (e.g. SensitiveValue) applied to each line's text. */
  wrap?: (node: React.ReactNode) => React.ReactNode;
}) {
  if (lines.length === 0) return null;
  return (
    <>
      {lines.map((l) => {
        const text = (
          <span style={{ direction: "ltr", unicodeBidi: "isolate", display: "inline-block", fontSize: size, fontWeight: weight, color: l.color ?? color }}>
            {l.text}
          </span>
        );
        return (
          <div key={l.text} style={{ textAlign: align, marginTop }}>
            {wrap ? wrap(text) : text}
          </div>
        );
      })}
    </>
  );
}
