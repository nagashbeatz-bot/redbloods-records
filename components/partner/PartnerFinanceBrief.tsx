/**
 * Redbloods Partner — "כסף" (Finance Brain brief). Presentational: no hooks, no fetch. All text comes from
 * the server DTO (rendered as plain, escaped text).
 *
 * When coverage is partial the monthly net is shown "לפי הנתונים הרשומים כרגע" with the coverage note
 * above it — never as an authoritative business result. At most 5 items.
 *
 * F2.8–F2.10: "צריך ממך" questions that carry `answer` get real answer buttons — but only when the
 * owning section passes `answerControls` (it does the POST + re-fetch). Without them, and for
 * display-only questions, the options stay plain text. While any answer is saving every control is disabled.
 */
import type { ReactNode } from "react";
import type { FinanceBriefDto, FinanceRehabQuestionDto } from "@/lib/partner/finance/dto";

const TEXT = "#F2F2F2";
const SUB = "#A0A0A0";
const MUTED = "#707070";
const BORDER = "rgba(255,255,255,0.07)";
const ACCENT = "#60A5FA";

const TAG: Record<FinanceBriefDto["items"][number]["epistemic"], string | null> = { FACT: null, DERIVED: null, HYPOTHESIS: "רעיון / השערה", UNKNOWN: "לא ידוע", OWNER_DECISION: null };

export interface FinanceAnswerControls {
  /** True while any answer is being saved — every control is disabled. */
  busy: boolean;
  /** The question whose answer is being saved / whose message is shown. */
  activeQuestionId: string | null;
  message: string | null;
  /** The question whose exact-date picker is open, and the picked date. */
  exactFor: string | null;
  exactYmd: string;
  /** Today (Israel) — the bound for exact dates (collection: not before; payment: not after). */
  todayYmd: string;
  onAnswer(q: FinanceRehabQuestionDto, answerCode: string): void;
  onOpenExact(q: FinanceRehabQuestionDto): void;
  onExactYmd(v: string): void;
  onConfirmExact(q: FinanceRehabQuestionDto): void;
  onCancelExact(): void;
  renderDatePicker(args: { value: string; onChange(v: string): void; min: string | undefined; max: string | undefined; ariaLabel: string; disabled: boolean }): ReactNode;
}

const optBtn = (disabled: boolean, primary = false) => ({
  fontSize: 12, fontWeight: 700, padding: "5px 11px", borderRadius: 99, minHeight: 30, cursor: disabled ? "default" : "pointer",
  color: primary ? "#0B1220" : TEXT, background: primary ? ACCENT : "rgba(255,255,255,0.05)", border: `1px solid ${primary ? ACCENT : "rgba(255,255,255,0.14)"}`, opacity: disabled ? 0.5 : 1,
} as const);

function QuestionCard({ q, controls }: { q: FinanceRehabQuestionDto; controls?: FinanceAnswerControls }) {
  const a = q.answer;
  const live = !!(a && controls);
  const mine = live && controls!.activeQuestionId === a!.questionId;
  const busy = live && controls!.busy;
  const exactOpen = live && controls!.exactFor === a!.questionId;
  return (
    <div data-rehab-question={q.questionType} data-answerable={live ? "true" : "false"} style={{ marginTop: 8, padding: "8px 10px", borderRadius: 9, background: "rgba(255,255,255,0.03)", border: `1px dashed ${BORDER}` }}>
      <p style={{ margin: 0, fontSize: 12.5, color: TEXT, lineHeight: 1.55 }}>{q.textHe}</p>
      <p style={{ margin: "3px 0 6px", fontSize: 11.5, color: MUTED }}>{q.whyHe}</p>
      {a?.previousAnswerHe && <p data-rehab-previous-answer style={{ margin: "0 0 6px", fontSize: 11.5, color: SUB }}>{a.previousAnswerHe}</p>}
      {live ? (
        <div role="group" aria-label="תשובה" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {q.options.map((o) => {
            const isExact = a!.exactDateCode === o.code;
            return (
              <button key={o.code} type="button" data-finance-answer={o.code} disabled={busy}
                onClick={() => (isExact ? controls!.onOpenExact(q) : controls!.onAnswer(q, o.code))}
                style={optBtn(busy)}>{o.labelHe}</button>
            );
          })}
        </div>
      ) : (
        <div aria-label="אפשרויות (לעיון בלבד — אי אפשר לענות על השאלה הזו כאן)" style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {q.options.map((o) => <span key={o.code} data-rehab-option style={{ fontSize: 11.5, color: SUB, padding: "2px 8px", borderRadius: 99, border: `1px solid ${BORDER}` }}>{o.labelHe}</span>)}
        </div>
      )}
      {exactOpen && (
        <div data-finance-exact-date style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {controls!.renderDatePicker({
            value: controls!.exactYmd, onChange: controls!.onExactYmd, disabled: busy,
            min: a!.exactDateRule === "NOT_BEFORE_TODAY" ? controls!.todayYmd : undefined,
            max: a!.exactDateRule === "NOT_AFTER_TODAY" ? controls!.todayYmd : undefined,
            ariaLabel: a!.exactDateRule === "NOT_AFTER_TODAY" ? "תאריך התשלום" : "תאריך הגבייה הצפוי",
          })}
          <p style={{ margin: 0, fontSize: 11.5, color: MUTED }}>זה נשמר כתשובה שלך ל-Partner — שום רישום בכספים לא משתנה.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button type="button" data-finance-exact-confirm disabled={busy || !controls!.exactYmd} onClick={() => controls!.onConfirmExact(q)} style={optBtn(busy || !controls!.exactYmd, true)}>שמור תאריך</button>
            <button type="button" disabled={busy} onClick={controls!.onCancelExact} style={optBtn(busy)}>ביטול</button>
          </div>
        </div>
      )}
      {mine && busy && <p role="status" aria-live="polite" style={{ margin: "6px 0 0", fontSize: 11.5, color: SUB }}>שומר…</p>}
      {mine && !busy && controls!.message && <p role="status" aria-live="polite" data-finance-answer-message style={{ margin: "6px 0 0", fontSize: 11.5, color: "#F59E0B" }}>{controls!.message}</p>}
    </div>
  );
}

export function PartnerFinanceBrief({ brief, isMobile, answerControls, notice }: { brief: FinanceBriefDto; isMobile: boolean; answerControls?: FinanceAnswerControls; notice?: string | null }) {
  const partial = brief.coverage === "PARTIAL";
  const hasRehab = brief.rehab.items.length > 0 || brief.rehab.questions.length > 0 || !!brief.rehab.questionsNoteHe || !!brief.rehab.actionNoteHe || !!notice;
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
        ) : brief.calmHe ? (
          <p data-finance-calm style={{ margin: "8px 0 0", fontSize: 13, color: SUB }}>{brief.calmHe}</p>
        ) : null}
        {hasRehab && (
          <div data-finance-rehab role="region" aria-label="צריך ממך" style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${BORDER}` }}>
            <h4 style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 800, color: SUB }}>צריך ממך</h4>
            {notice && <p role="status" aria-live="polite" data-finance-notice style={{ margin: "0 0 6px", fontSize: 12, color: SUB }}>{notice}</p>}
            {brief.rehab.items.length > 0 && (
              <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
                {brief.rehab.items.map((it) => (
                  <li key={it.textHe} data-rehab-item={it.issueType} data-epistemic={it.epistemic} style={{ fontSize: 12.5, color: TEXT, lineHeight: 1.55 }}>
                    {TAG[it.epistemic] && <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginInlineEnd: 6 }}>{TAG[it.epistemic]}</span>}
                    {it.textHe}
                  </li>
                ))}
              </ol>
            )}
            {brief.rehab.actionNoteHe && <p data-finance-action-note style={{ margin: "8px 0 0", fontSize: 12, color: SUB, lineHeight: 1.55 }}>{brief.rehab.actionNoteHe}</p>}
            {brief.rehab.questionsNoteHe && <p data-finance-questions-note style={{ margin: "8px 0 0", fontSize: 11.5, color: MUTED }}>{brief.rehab.questionsNoteHe}</p>}
            {brief.rehab.questions.map((q) => <QuestionCard key={q.answer?.questionId ?? q.textHe} q={q} controls={answerControls} />)}
          </div>
        )}
      </div>
    </div>
  );
}
