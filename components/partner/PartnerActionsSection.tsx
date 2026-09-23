"use client";

/**
 * Redbloods Partner — Owner-only Suggested Action surface on the dashboard
 * (F.1I read-only; F.1J Owner decisions; F.1K deliberate execution).
 *
 * - Fetches GET /api/partner/actions and parses it strictly (fail closed).
 * - Decisions go ONLY to POST /api/partner/actions/decide (APPROVE / NOT_NOW) and
 *   POST /api/partner/actions/change-deadline ("שנה תאריך" → Owner Context revision).
 *   "אשר" records the approval only — nothing executes after it.
 * - Execution goes ONLY to POST /api/partner/actions/execute, and ONLY from the
 *   explicit "בצע עכשיו" click on an AWAITING_EXECUTION card (never automatically).
 * - Each attempt gets its own requestId; "נסה שוב" re-sends the SAME attempt (same
 *   body, same requestId). No automatic retries, no optimistic changes: the server
 *   result is shown, then the surface is re-fetched — the persisted chain is authoritative.
 * - While submitting every control is disabled (and a ref blocks double clicks).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRole } from "@/lib/use-role";
import DatePickerInput from "@/components/ui/DatePickerInput";
import { parseActionSurfaceResponse, type ChangeValueAnswerCode, type PartnerActionCardDto } from "@/lib/partner/actions/surface-dto";
import { PartnerActionsView, type CardControls } from "./PartnerActionCard";
import {
  buildApproveAttempt, buildChangeAttempt, buildExecuteAttempt, buildNotNowAttempt, interpretDecisionResponse, interpretExecuteResponse, phaseForOutcome,
  type DecisionAttempt, type DecisionOutcome, type DecisionPhase, type ExecuteAttempt, type NotNowChoice,
} from "./partner-decision-client";

/** One submittable attempt: its exact body (incl. requestId) and how to read the answer. */
interface Attempt { url: string; body: Record<string, unknown>; interpret(status: number, json: unknown): DecisionOutcome }
const decisionAttempt = (a: DecisionAttempt | null): Attempt | null => a && { url: a.url, body: a.body, interpret: (s, j) => interpretDecisionResponse(a.kind, s, j) };
const executeAttempt = (a: ExecuteAttempt | null): Attempt | null => a && { url: a.url, body: a.body, interpret: interpretExecuteResponse };

interface UiState {
  actionId: string | null;
  phase: DecisionPhase;
  panel: "none" | "notNow" | "change";
  message: string | null;
  retryAttempt: Attempt | null;
  notNowChoice: NotNowChoice | null;
  customYmd: string;
  changeCode: ChangeValueAnswerCode | null;
  changeYmd: string;
}
const IDLE: UiState = { actionId: null, phase: "idle", panel: "none", message: null, retryAttempt: null, notNowChoice: null, customYmd: "", changeCode: null, changeYmd: "" };

const newRequestId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "");

export default function PartnerActionsSection({ isMobile }: { isMobile: boolean }) {
  const role = useRole();
  const [items, setItems] = useState<PartnerActionCardDto[]>([]);
  const [ui, setUi] = useState<UiState>(IDLE);
  const [notice, setNotice] = useState<string | null>(null);
  const submitting = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/partner/actions", { cache: "no-store", signal });
      if (!res.ok) { setItems([]); return; }
      const parsed = parseActionSurfaceResponse(await res.json());
      if (!parsed.ok) { console.warn("[partner-actions] malformed surface payload — not rendered"); setItems([]); return; }
      setItems(parsed.items);
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") setItems([]);
    }
  }, []);

  useEffect(() => {
    if (role !== "owner") return;
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [role, load]);

  const submit = useCallback(async (actionId: string, attempt: Attempt | null) => {
    if (!attempt || submitting.current) return;
    if ("requestId" in attempt.body && !attempt.body.requestId) { setUi((u) => ({ ...u, actionId, phase: "error", message: "הדפדפן לא תומך — לא נשמר דבר.", retryAttempt: null })); return; }
    submitting.current = true;
    setNotice(null);
    setUi((u) => ({ ...u, actionId, phase: "submitting", message: null, retryAttempt: null }));
    let status = 0, body: unknown = null;
    try {
      const res = await fetch(attempt.url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(attempt.body) });
      status = res.status;
      try { body = await res.json(); } catch { body = null; }
    } catch { status = 503; body = { status: "RETRYABLE" }; }
    const outcome = attempt.interpret(status, body);
    submitting.current = false;
    // RETRYABLE: keep the SAME attempt (same requestId) for a manual "נסה שוב" — no automatic loop.
    if (outcome.ui === "retry") setUi((u) => ({ ...u, actionId, phase: "error", message: outcome.messageHe, retryAttempt: attempt }));
    else {
      const phase = phaseForOutcome(outcome);
      // Success / changed state re-renders or removes the card → the message lives at section level.
      // (An approval needs no notice: the re-fetched AWAITING_EXECUTION card itself says so.)
      if (phase === "success" || phase === "stale") { setNotice(outcome.ui === "approved" ? null : outcome.messageHe); setUi(IDLE); }
      else setUi({ ...IDLE, actionId, phase, message: outcome.messageHe });
    }
    // The persisted Action Event chain is authoritative: always re-fetch after any answer
    // (RETRYABLE included — its outcome may be unknown; the re-fetched chain shows what really happened).
    await load();
  }, [load]);

  if (role !== "owner") return null;

  const controlsFor = (item: PartnerActionCardDto): CardControls | undefined => {
    const mine = ui.actionId === item.actionId;
    const s = mine ? ui : IDLE;
    const otherBusy = ui.phase === "submitting" && !mine;
    return {
      phase: otherBusy ? "submitting" : s.phase,
      panel: s.panel, message: s.message, canRetry: mine && !!ui.retryAttempt,
      notNowChoice: s.notNowChoice, customYmd: s.customYmd, changeCode: s.changeCode, changeYmd: s.changeYmd,
      onApprove: () => submit(item.actionId, decisionAttempt(buildApproveAttempt(item, newRequestId()))),
      onOpenNotNow: () => setUi({ ...IDLE, actionId: item.actionId, panel: "notNow" }),
      onOpenChange: () => setUi({ ...IDLE, actionId: item.actionId, panel: "change" }),
      onCancel: () => setUi(IDLE),
      onRetry: () => { const a = ui.retryAttempt; if (a) submit(item.actionId, a); },
      onNotNowChoice: (c) => setUi((u) => ({ ...u, notNowChoice: c })),
      onCustomYmd: (v) => setUi((u) => ({ ...u, customYmd: v })),
      onConfirmNotNow: () => { if (s.notNowChoice) submit(item.actionId, decisionAttempt(buildNotNowAttempt(item, newRequestId(), s.notNowChoice, s.notNowChoice === "CUSTOM" ? s.customYmd : null))); },
      onChangeCode: (c) => setUi((u) => ({ ...u, changeCode: c })),
      onChangeYmd: (v) => setUi((u) => ({ ...u, changeYmd: v })),
      onConfirmChange: () => { if (s.changeCode) submit(item.actionId, decisionAttempt(buildChangeAttempt(item, s.changeCode, s.changeCode === "SPECIFIC_DATE" ? s.changeYmd : null))); },
      // F.1K: the ONLY execution trigger — a deliberate click on an AWAITING_EXECUTION card, one requestId per attempt.
      onExecute: () => submit(item.actionId, executeAttempt(buildExecuteAttempt(item, newRequestId()))),
      renderDatePicker: ({ value, onChange, min, ariaLabel }) => (
        <div aria-label={ariaLabel}><DatePickerInput value={value} onChange={onChange} min={min} placeholder="בחר תאריך…" /></div>
      ),
    };
  };

  return <PartnerActionsView items={items} isMobile={isMobile} controlsFor={controlsFor} notice={notice} />;
}
