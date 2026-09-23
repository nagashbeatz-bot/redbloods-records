/**
 * Redbloods Partner — recent executed Action + its current derived Outcome (Phase F.1M).
 * Presentational and READ-ONLY: no hooks, no fetch, no buttons, no handlers. All text comes from the
 * server DTO (rendered as plain, escaped text).
 *
 * The HISTORICAL executed change ("בוצע: from → to", when) is always shown apart from the CURRENT
 * live value ("מצב נוכחי"); the current value is never presented as what Partner executed.
 */
import type { PartnerOutcomeCardDto } from "@/lib/partner/actions/outcome-dto";

const TEXT = "#F2F2F2";
const SUB = "#A0A0A0";
const MUTED = "#707070";
const BORDER = "rgba(255,255,255,0.07)";

const TONE: Record<PartnerOutcomeCardDto["state"], { chip: string; chipBg: string; border: string }> = {
  APPLIED_AS_EXPECTED: { chip: "#4ADE80", chipBg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.2)" },
  LIVE_STATE_CHANGED_AFTER_EXECUTION: { chip: "#4ADE80", chipBg: "rgba(34,197,94,0.12)", border: BORDER },
  TARGET_NOT_FOUND: { chip: "#F59E0B", chipBg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.25)" },
  READ_FAILED: { chip: SUB, chipBg: "rgba(255,255,255,0.06)", border: BORDER },
};

function ValueBox({ label, value, kind }: { label: string; value: string; kind: "executed" | "current" }) {
  return (
    <div data-outcome-value={kind} style={{ flex: "1 1 0", minWidth: 0, borderRadius: 10, padding: "6px 10px", background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 2 }}>{label}</div>
      <bdi dir="ltr" style={{ fontSize: 15, fontWeight: 800, color: kind === "executed" ? TEXT : SUB, letterSpacing: "0.02em" }}>{value}</bdi>
    </div>
  );
}

export function PartnerOutcomeCard({ item, isMobile }: { item: PartnerOutcomeCardDto; isMobile: boolean }) {
  const tone = TONE[item.state];
  return (
    <article data-partner-outcome={item.executedEventId} data-outcome-state={item.state}
      style={{ background: "#161616", border: `1px solid ${tone.border}`, borderRadius: 12, padding: isMobile ? "10px 12px" : "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <span data-outcome-badge style={{ display: "inline-flex", fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 99, color: tone.chip, background: tone.chipBg }}>{item.badgeHe}</span>
        <span style={{ fontSize: 11.5, color: MUTED }}>בוצע ב־<bdi dir="ltr">{item.executedAtHe}</bdi></span>
      </div>
      <p data-outcome-headline style={{ margin: "0 0 8px", fontSize: isMobile ? 14 : 14.5, fontWeight: 700, color: TEXT, lineHeight: 1.5 }}>{item.headlineHe}</p>
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 6 : 10 }}>
        <ValueBox kind="executed" label={`מה Partner ביצע (מ־${item.executedFromHe})`} value={item.executedToHe} />
        {item.currentValueHe !== null && <ValueBox kind="current" label="מצב נוכחי" value={item.currentValueHe} />}
      </div>
      <p data-outcome-status style={{ margin: "8px 0 0", fontSize: 12.5, color: item.state === "TARGET_NOT_FOUND" ? "#F59E0B" : SUB }}>{item.statusHe}</p>
    </article>
  );
}

/** "בוצע לאחרונה" — the recent executed Actions block inside the Partner section. Renders nothing when empty. */
export function PartnerOutcomesList({ items, isMobile }: { items: PartnerOutcomeCardDto[]; isMobile: boolean }) {
  if (!items.length) return null;
  return (
    <div data-partner-outcomes aria-label="Partner — פעולות שבוצעו לאחרונה" role="region" style={{ marginTop: 10 }}>
      <h3 style={{ margin: "0 0 6px", fontSize: 12.5, fontWeight: 800, color: SUB }}>בוצע לאחרונה</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((it) => <PartnerOutcomeCard key={it.executedEventId} item={it} isMobile={isMobile} />)}
      </div>
    </div>
  );
}
