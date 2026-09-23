/**
 * Redbloods Partner — "כסף" (Finance Brain V1 brief). Presentational and READ-ONLY: no hooks, no fetch,
 * no buttons, no handlers. All text comes from the server DTO (rendered as plain, escaped text).
 *
 * When coverage is partial the monthly net is shown "לפי הנתונים הרשומים כרגע" with the coverage note
 * above it — never as an authoritative business result. At most 5 items.
 */
import type { FinanceBriefDto } from "@/lib/partner/finance/dto";

const TEXT = "#F2F2F2";
const SUB = "#A0A0A0";
const MUTED = "#707070";
const BORDER = "rgba(255,255,255,0.07)";

const TAG: Record<FinanceBriefDto["items"][number]["epistemic"], string | null> = { FACT: null, DERIVED: null, HYPOTHESIS: "רעיון / השערה", UNKNOWN: "לא ידוע" };

export function PartnerFinanceBrief({ brief, isMobile }: { brief: FinanceBriefDto; isMobile: boolean }) {
  const partial = brief.coverage === "PARTIAL";
  return (
    <div data-partner-finance role="region" aria-label="Partner — כסף" style={{ marginTop: 10 }}>
      <h3 style={{ margin: "0 0 6px", fontSize: 12.5, fontWeight: 800, color: SUB }}>כסף</h3>
      <div style={{ background: "#161616", border: `1px solid ${BORDER}`, borderRadius: 12, padding: isMobile ? "10px 12px" : "12px 14px" }}>
        {brief.coverageNoteHe && (
          <p data-finance-coverage={brief.coverage} style={{ margin: "0 0 8px", fontSize: 12, color: partial ? "#F59E0B" : MUTED, lineHeight: 1.55 }}>{brief.coverageNoteHe}</p>
        )}
        <div data-finance-summary style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 4 : 12, alignItems: isMobile ? "stretch" : "baseline", marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>{brief.summary.basisHe}</span>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: partial ? SUB : TEXT, lineHeight: 1.55 }}>{brief.summary.lineHe}</p>
        </div>
        {brief.summary.positionLineHe && <p data-finance-position style={{ margin: "0 0 4px", fontSize: 12.5, color: SUB }}>{brief.summary.positionLineHe}</p>}
        {brief.summary.otherCurrencyLineHe && <p data-finance-other-currency style={{ margin: "0 0 4px", fontSize: 12.5, color: SUB }}>{brief.summary.otherCurrencyLineHe}</p>}
        {brief.items.length > 0 ? (
          <ol data-finance-items style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {brief.items.map((it) => (
              <li key={it.family} data-finance-item={it.family} data-epistemic={it.epistemic}
                style={{ fontSize: 13, color: TEXT, lineHeight: 1.55, padding: "6px 10px", borderRadius: 9, background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}` }}>
                {TAG[it.epistemic] && <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginInlineEnd: 6 }}>{TAG[it.epistemic]}</span>}
                {it.textHe}
              </li>
            ))}
          </ol>
        ) : (
          <p data-finance-calm style={{ margin: "8px 0 0", fontSize: 13, color: SUB }}>{brief.calmHe}</p>
        )}
      </div>
    </div>
  );
}
