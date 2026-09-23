/**
 * Redbloods Partner — Suggested Action card (Phase F.1I; decision controls in F.1J).
 * Presentational only: no hooks, no fetch. All state and handlers come from
 * PartnerActionsSection through `controls`; the date picker is injected so the
 * card renders statically in tests. Text comes from the server DTO and is
 * rendered as plain (escaped) text.
 *
 * SHOW card:               [אשר] [לא עכשיו] [שנה תאריך] — "אשר" only records the approval (execution is a later phase).
 * AWAITING_EXECUTION card:  "הפעולה אושרה" + the change EXACTLY as approved (persisted snapshot) + "השינוי עדיין לא בוצע."
 *                          + a deliberate [בצע עכשיו] (F.1K). Never a fresh proposal, never looks already changed.
 */
import type { ReactNode } from "react";
import type { ChangeValueAnswerCode, PartnerActionCardDto } from "@/lib/partner/actions/surface-dto";
import { NOT_NOW_CHOICES, type DecisionPhase, type NotNowChoice } from "./partner-decision-client";

const CARD = "#181818";
const BORDER = "rgba(255,255,255,0.07)";
const TEXT = "#F2F2F2";
const SUB = "#A0A0A0";
const MUTED = "#707070";
const ACCENT = "#60A5FA";

export interface CardControls {
  phase: DecisionPhase;
  panel: "none" | "notNow" | "change";
  message: string | null;
  canRetry: boolean;
  notNowChoice: NotNowChoice | null;
  customYmd: string;
  changeCode: ChangeValueAnswerCode | null;
  changeYmd: string;
  onApprove(): void;
  onOpenNotNow(): void;
  onOpenChange(): void;
  onCancel(): void;
  onRetry(): void;
  onNotNowChoice(c: NotNowChoice): void;
  onCustomYmd(v: string): void;
  onConfirmNotNow(): void;
  onChangeCode(c: ChangeValueAnswerCode): void;
  onChangeYmd(v: string): void;
  onConfirmChange(): void;
  /** F.1K: execute the APPROVED action (AWAITING_EXECUTION cards only). */
  onExecute(): void;
  renderDatePicker(args: { value: string; onChange(v: string): void; min: string; ariaLabel: string; disabled: boolean }): ReactNode;
}

function DateBox({ label, value, tone }: { label: string; value: string; tone: "current" | "suggested" }) {
  const accent = tone === "suggested";
  return (
    <div data-date-box={tone} style={{
      flex: "1 1 0", minWidth: 0, borderRadius: 12, padding: "8px 12px",
      background: accent ? "rgba(96,165,250,0.08)" : "rgba(255,255,255,0.03)",
      border: `1px solid ${accent ? "rgba(96,165,250,0.28)" : BORDER}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: accent ? ACCENT : MUTED, marginBottom: 2 }}>{label}</div>
      {/* No strike-through: the current value is still the real persisted deadline until an approved action is executed. */}
      <bdi dir="ltr" style={{ fontSize: 18, fontWeight: 800, color: accent ? TEXT : SUB, letterSpacing: "0.02em" }}>{value}</bdi>
    </div>
  );
}

const btn = (kind: "primary" | "secondary", isMobile: boolean, disabled: boolean): React.CSSProperties => ({
  flex: isMobile ? "1 1 30%" : "0 0 auto", minHeight: isMobile ? 44 : 36, padding: isMobile ? "10px 12px" : "7px 16px",
  borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1,
  color: kind === "primary" ? "#0B1220" : TEXT, background: kind === "primary" ? ACCENT : "rgba(255,255,255,0.06)",
  border: `1px solid ${kind === "primary" ? ACCENT : "rgba(255,255,255,0.14)"}`,
});

function ChoiceList<T extends string>({ name, legend, options, value, onChange, disabled }: { name: string; legend: string; options: ReadonlyArray<{ code: T; labelHe: string }>; value: T | null; onChange(c: T): void; disabled: boolean }) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0 }} disabled={disabled}>
      <legend style={{ fontSize: 12, fontWeight: 700, color: SUB, marginBottom: 6, padding: 0 }}>{legend}</legend>
      <div role="radiogroup" aria-label={legend} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {options.map((o) => (
          <label key={o.code} style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 36, padding: "6px 10px", borderRadius: 9, cursor: "pointer", fontSize: 13, color: value === o.code ? TEXT : SUB, background: value === o.code ? "rgba(96,165,250,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${value === o.code ? "rgba(96,165,250,0.4)" : BORDER}` }}>
            <input type="radio" name={name} value={o.code} checked={value === o.code} onChange={() => onChange(o.code)} style={{ accentColor: ACCENT, margin: 0 }} />
            {o.labelHe}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>;
}

function StatusLine({ controls, retryLabel = "נסה שוב" }: { controls: CardControls; retryLabel?: string }) {
  const busy = controls.phase === "submitting";
  return (
    <div aria-live="polite" role="status" style={{ minHeight: 0 }}>
      {busy && <p style={{ margin: "10px 0 0", fontSize: 12.5, color: SUB }}>שומר…</p>}
      {!busy && controls.message && (
        <p data-decision-message={controls.phase} style={{ margin: "10px 0 0", fontSize: 12.5, color: controls.phase === "error" ? "#F59E0B" : SUB }}>
          {controls.message}
          {controls.canRetry && <> <button type="button" onClick={controls.onRetry} style={{ ...btn("secondary", false, false), minHeight: 28, padding: "2px 10px", fontSize: 12 }}>{retryLabel}</button></>}
        </p>
      )}
    </div>
  );
}

/** F.1K: an APPROVED action waiting for a deliberate execution — shows the persisted approved change only. */
function AwaitingExecutionCard({ item, isMobile, controls }: { item: PartnerActionCardDto; isMobile: boolean; controls?: CardControls }) {
  const busy = controls?.phase === "submitting";
  return (
    <article data-partner-action={item.actionId} data-state={item.state} aria-busy={busy || undefined}
      style={{ background: CARD, border: "1px solid rgba(34,197,94,0.25)", borderRadius: 14, padding: isMobile ? "12px 12px 10px" : "14px 16px 12px" }}>
      <p style={{ margin: "0 0 6px", fontSize: isMobile ? 15 : 16, fontWeight: 800, color: "#4ADE80" }}>הפעולה אושרה</p>
      <p data-approved-change style={{ margin: 0, fontSize: 14, color: TEXT, lineHeight: 1.6 }}>
        עדכון הדדליין של &apos;{item.projectName}&apos; מ־<bdi dir="ltr">{item.currentDeadlineHe}</bdi> ל־<bdi dir="ltr">{item.suggestedDeadlineHe}</bdi>
      </p>
      <p data-awaiting-note style={{ margin: "6px 0 0", fontSize: 12.5, fontWeight: 700, color: SUB }}>השינוי עדיין לא בוצע.</p>
      {controls && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            <button type="button" onClick={controls.onExecute} disabled={busy} style={btn("primary", isMobile, !!busy)}>בצע עכשיו</button>
          </div>
          <StatusLine controls={controls} />
        </>
      )}
    </article>
  );
}

export function PartnerActionCard({ item, isMobile, controls }: { item: PartnerActionCardDto; isMobile: boolean; controls?: CardControls }) {
  if (item.state === "AWAITING_EXECUTION") return <AwaitingExecutionCard item={item} isMobile={isMobile} controls={controls} />;
  const busy = controls?.phase === "submitting";
  return (
    <article data-partner-action={item.actionId} data-state={item.state} aria-busy={busy || undefined}
      style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: isMobile ? "12px 12px 10px" : "14px 16px 12px" }}>
      <p style={{ margin: "0 0 10px", fontSize: isMobile ? 15 : 16, fontWeight: 800, color: TEXT, lineHeight: 1.45 }}>{item.headlineHe}</p>
      <div role="group" aria-label={`מ-${item.currentDeadlineHe} ל-${item.suggestedDeadlineHe}`}
        style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", gap: isMobile ? 6 : 12, marginBottom: 10 }}>
        <DateBox label="מה קיים עכשיו" value={item.currentDeadlineHe} tone="current" />
        <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1, color: MUTED, flex: "0 0 auto", textAlign: "center" }}>{isMobile ? "↓" : "←"}</span>
        <DateBox label="מה Partner מציע" value={item.suggestedDeadlineHe} tone="suggested" />
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 2 }}>למה</div>
      <p style={{ margin: 0, fontSize: 13.5, color: SUB, lineHeight: 1.6 }}>{item.reasonHe || item.explanationHe}</p>

      {controls && (
        <>
          {controls.panel === "none" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              <button type="button" onClick={controls.onApprove} disabled={busy} style={btn("primary", isMobile, busy)}>אשר</button>
              <button type="button" onClick={controls.onOpenNotNow} disabled={busy} style={btn("secondary", isMobile, busy)}>לא עכשיו</button>
              <button type="button" onClick={controls.onOpenChange} disabled={busy} style={btn("secondary", isMobile, busy)}>שנה תאריך</button>
            </div>
          )}
          {controls.panel === "notNow" && (
            <Panel>
              <ChoiceList name={`not-now-${item.actionId}`} legend="מתי לחזור לזה?" options={NOT_NOW_CHOICES} value={controls.notNowChoice} onChange={controls.onNotNowChoice} disabled={busy} />
              {controls.notNowChoice === "CUSTOM" && controls.renderDatePicker({ value: controls.customYmd, onChange: controls.onCustomYmd, min: item.minChangeDate, ariaLabel: "תאריך לחזרה להצעה", disabled: busy })}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button type="button" onClick={controls.onConfirmNotNow} disabled={busy || !controls.notNowChoice || (controls.notNowChoice === "CUSTOM" && !controls.customYmd)} style={btn("primary", isMobile, busy || !controls.notNowChoice)}>שמור</button>
                <button type="button" onClick={controls.onCancel} disabled={busy} style={btn("secondary", isMobile, busy)}>ביטול</button>
              </div>
            </Panel>
          )}
          {controls.panel === "change" && (
            <Panel>
              <ChoiceList name={`change-${item.actionId}`} legend="מה הדדליין החדש לפרויקט?" options={item.changeValueOptions} value={controls.changeCode} onChange={controls.onChangeCode} disabled={busy} />
              {controls.changeCode === "SPECIFIC_DATE" && controls.renderDatePicker({ value: controls.changeYmd, onChange: controls.onChangeYmd, min: item.minChangeDate, ariaLabel: "הדדליין החדש", disabled: busy })}
              <p style={{ margin: 0, fontSize: 11.5, color: MUTED }}>זה מעדכן את התשובה שלך ל-Partner — הפרויקט עצמו לא משתנה.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button type="button" onClick={controls.onConfirmChange} disabled={busy || !controls.changeCode || (controls.changeCode === "SPECIFIC_DATE" && !controls.changeYmd)} style={btn("primary", isMobile, busy || !controls.changeCode)}>שמור תאריך</button>
                <button type="button" onClick={controls.onCancel} disabled={busy} style={btn("secondary", isMobile, busy)}>ביטול</button>
              </div>
            </Panel>
          )}
          <StatusLine controls={controls} />
        </>
      )}
    </article>
  );
}

/** The whole Partner block. Renders nothing when there is nothing to show and no pending notice. */
export function PartnerActionsView({ items, isMobile, controlsFor, notice }: { items: PartnerActionCardDto[]; isMobile: boolean; controlsFor?: (item: PartnerActionCardDto) => CardControls | undefined; notice?: string | null }) {
  if (!items.length && !notice) return null;
  const fresh = items.filter((i) => i.state === "SHOW").length;
  return (
    <section dir="rtl" lang="he" aria-label="Partner — הצעות לפעולה" data-partner-actions
      style={{ background: "#131313", border: `1px solid ${BORDER}`, borderRadius: 16, padding: isMobile ? "12px 12px 10px" : "14px 14px 12px", marginBottom: 18 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: items.length ? 10 : 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: ACCENT }} />
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: TEXT }}>Partner</h2>
        {items.length > 0 && (
          <span style={{ display: "inline-flex", fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 99, color: ACCENT, background: "rgba(96,165,250,0.12)" }}>
            {fresh > 0 ? "הצעה לפעולה" : items[0].statusLabelHe}{items.length > 1 ? ` · ${items.length}` : ""}
          </span>
        )}
      </header>
      {notice && <p role="status" aria-live="polite" data-partner-notice style={{ margin: "0 0 8px", fontSize: 12.5, color: SUB }}>{notice}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((it) => <PartnerActionCard key={it.actionId} item={it} isMobile={isMobile} controls={controlsFor?.(it)} />)}
      </div>
    </section>
  );
}
