/**
 * Redbloods Partner — Company Integrity "צריך ממך" (presentational: no hooks, no fetch).
 *
 * Shows ONLY the questions the live register surfaces right now (max 2): who it is about, the ambiguity in plain
 * Hebrew, names + statuses as evidence, the choices and a save button. Never shows ids, tables, hashes or schema
 * names (the echo fields exist on the DTO only for the POST). Below: a short "מה למדתי" list of earlier answers.
 */
import type { IntegritySurfaceDto, IntegrityQuestionDto } from "@/lib/partner/integrity/dto";

const TEXT = "#F2F2F2";
const SUB = "#A0A0A0";
const MUTED = "#707070";
const BORDER = "rgba(255,255,255,0.07)";
const ACCENT = "#60A5FA";

export interface IntegrityControls {
  busy: boolean;
  selected: Record<string, string>;
  onSelect(q: IntegrityQuestionDto, code: string): void;
  onSave(q: IntegrityQuestionDto): void;
}

const optStyle = (on: boolean, disabled: boolean): React.CSSProperties => ({
  textAlign: "start", fontSize: 12.5, lineHeight: 1.45, color: on ? TEXT : SUB, padding: "7px 10px", borderRadius: 9, cursor: disabled ? "default" : "pointer",
  background: on ? "rgba(96,165,250,0.12)" : "rgba(255,255,255,0.02)", border: `1px solid ${on ? ACCENT : BORDER}`, opacity: disabled ? 0.6 : 1, width: "100%", boxSizing: "border-box",
});

function QuestionCard({ q, controls }: { q: IntegrityQuestionDto; controls: IntegrityControls }) {
  const chosen = controls.selected[q.questionId] ?? null;
  return (
    <li data-integrity-question style={{ listStyle: "none", padding: "10px 12px", borderRadius: 11, background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}` }}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: SUB }}>{q.subjectLabel}</p>
      <p style={{ margin: "3px 0 6px", fontSize: 13.5, color: TEXT, lineHeight: 1.55 }}>{q.textHe}</p>
      {q.evidenceHe.length > 0 && (
        <ul data-integrity-evidence style={{ margin: "0 0 6px", paddingInlineStart: 18, fontSize: 12, color: SUB, lineHeight: 1.6 }}>
          {q.evidenceHe.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      <p style={{ margin: "0 0 8px", fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>{q.whyHe}</p>
      {q.previousAnswerHe && <p data-integrity-previous-answer style={{ margin: "0 0 8px", fontSize: 11.5, color: "#F59E0B", lineHeight: 1.5 }}>{q.previousAnswerHe}</p>}
      <div role="radiogroup" aria-label="תשובה" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {q.options.map((o) => (
          <button key={o.code} type="button" role="radio" aria-checked={chosen === o.code} data-integrity-option disabled={controls.busy}
            onClick={() => controls.onSelect(q, o.code)} style={optStyle(chosen === o.code, controls.busy)}>{o.labelHe}</button>
        ))}
      </div>
      <button type="button" data-integrity-save disabled={controls.busy || !chosen} onClick={() => controls.onSave(q)}
        style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, padding: "6px 14px", borderRadius: 9, border: `1px solid ${ACCENT}`, background: chosen && !controls.busy ? ACCENT : "transparent", color: chosen && !controls.busy ? "#0B0B0B" : SUB, cursor: chosen && !controls.busy ? "pointer" : "default" }}>
        {controls.busy ? "שומר…" : "שמור תשובה"}
      </button>
    </li>
  );
}

export function PartnerIntegrityView({ surface, isMobile, controls, message }: { surface: IntegritySurfaceDto; isMobile: boolean; controls: IntegrityControls; message: string | null }) {
  const learned = surface.learned.slice(0, 6);
  if (!surface.questions.length && !learned.length && !message) return null;
  return (
    <div data-partner-integrity role="region" aria-label="Partner — צריך ממך" style={{ marginTop: 10 }}>
      <h3 style={{ margin: "0 0 6px", fontSize: 12.5, fontWeight: 800, color: SUB }}>צריך ממך</h3>
      <div style={{ background: "#161616", border: `1px solid ${BORDER}`, borderRadius: 12, padding: isMobile ? "10px 12px" : "12px 14px" }}>
        {message && <p role="status" aria-live="polite" data-integrity-message style={{ margin: "0 0 8px", fontSize: 12.5, color: TEXT }}>{message}</p>}
        {surface.questions.length > 0 ? (
          <ol style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {surface.questions.map((q) => <QuestionCard key={q.questionId} q={q} controls={controls} />)}
          </ol>
        ) : (
          <p data-integrity-calm style={{ margin: 0, fontSize: 12.5, color: SUB }}>אין כרגע שאלות פתוחות ממני.</p>
        )}
        {surface.deferredCount > 0 && <p data-integrity-deferred style={{ margin: "8px 0 0", fontSize: 11.5, color: MUTED }}>יש עוד {surface.deferredCount === 1 ? "שאלה אחת" : `${surface.deferredCount} שאלות`} — אשאל אחרי שנסגור את אלה.</p>}
        {learned.length > 0 && (
          <div data-integrity-learned style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${BORDER}` }}>
            <p style={{ margin: "0 0 4px", fontSize: 11.5, fontWeight: 700, color: MUTED }}>מה למדתי ממך</p>
            {learned.map((l) => (
              <p key={`${l.subjectLabel}|${l.answerLabelHe}|${l.statusHe}`} style={{ margin: "2px 0", fontSize: 12, color: SUB, lineHeight: 1.5 }}>
                <span style={{ color: TEXT }}>{l.subjectLabel}</span>: {l.answerLabelHe} <span style={{ color: MUTED }}>({l.statusHe})</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
