/**
 * Redbloods Partner — Suggested Action card (Phase F.1I). Presentational only:
 * no hooks, no fetch, no handlers. READ-ONLY — there are deliberately no
 * decision buttons (approve / not now / change date arrive in F.1J).
 * All text comes from the server DTO and is rendered as plain (escaped) text.
 */
import type { PartnerActionCardDto } from "@/lib/partner/actions/surface-dto";

const CARD = "#181818";
const BORDER = "rgba(255,255,255,0.07)";
const TEXT = "#F2F2F2";
const SUB = "#A0A0A0";
const MUTED = "#707070";
const ACCENT = "#60A5FA";

function DateBox({ label, value, tone }: { label: string; value: string; tone: "current" | "suggested" }) {
  const accent = tone === "suggested";
  return (
    <div data-date-box={tone} style={{
      flex: "1 1 0", minWidth: 0, borderRadius: 12, padding: "8px 12px",
      background: accent ? "rgba(96,165,250,0.08)" : "rgba(255,255,255,0.03)",
      border: `1px solid ${accent ? "rgba(96,165,250,0.28)" : BORDER}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: accent ? ACCENT : MUTED, marginBottom: 2 }}>{label}</div>
      {/* No strike-through: the current value is still the real persisted deadline — nothing has been approved. */}
      <bdi dir="ltr" style={{ fontSize: 18, fontWeight: 800, color: accent ? TEXT : SUB, letterSpacing: "0.02em" }}>{value}</bdi>
    </div>
  );
}

export function PartnerActionCard({ item, isMobile }: { item: PartnerActionCardDto; isMobile: boolean }) {
  return (
    <article data-partner-action={item.actionId} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: isMobile ? "12px 12px 10px" : "14px 16px 12px" }}>
      <p style={{ margin: "0 0 10px", fontSize: isMobile ? 15 : 16, fontWeight: 800, color: TEXT, lineHeight: 1.45 }}>{item.headlineHe}</p>
      <div role="group" aria-label={`מ-${item.currentDeadlineHe} ל-${item.suggestedDeadlineHe}`}
        style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", gap: isMobile ? 6 : 12, marginBottom: 10 }}>
        <DateBox label="מה קיים עכשיו" value={item.currentDeadlineHe} tone="current" />
        <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1, color: MUTED, flex: "0 0 auto", textAlign: "center" }}>{isMobile ? "↓" : "←"}</span>
        <DateBox label="מה Partner מציע" value={item.suggestedDeadlineHe} tone="suggested" />
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 2 }}>למה</div>
      <p style={{ margin: 0, fontSize: 13.5, color: SUB, lineHeight: 1.6 }}>{item.reasonHe || item.explanationHe}</p>
      <p data-read-only-note style={{ margin: "10px 0 0", fontSize: 11.5, color: MUTED }}>תצוגה בלבד — אישור, דחייה ושינוי תאריך יתווספו בשלב הבא.</p>
    </article>
  );
}

/** The whole Partner block. Renders nothing when there is nothing to show (calm empty state). */
export function PartnerActionsView({ items, isMobile }: { items: PartnerActionCardDto[]; isMobile: boolean }) {
  if (!items.length) return null;
  return (
    <section dir="rtl" lang="he" aria-label="Partner — הצעות לפעולה" data-partner-actions
      style={{ background: "#131313", border: `1px solid ${BORDER}`, borderRadius: 16, padding: isMobile ? "12px 12px 10px" : "14px 14px 12px", marginBottom: 18 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: ACCENT }} />
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: TEXT }}>Partner</h2>
        <span style={{ display: "inline-flex", fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 99, color: ACCENT, background: "rgba(96,165,250,0.12)" }}>
          {items[0].statusLabelHe}{items.length > 1 ? ` · ${items.length}` : ""}
        </span>
      </header>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((it) => <PartnerActionCard key={it.actionId} item={it} isMobile={isMobile} />)}
      </div>
    </section>
  );
}
