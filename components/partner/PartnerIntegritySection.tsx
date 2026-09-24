"use client";

/**
 * Redbloods Partner — Owner-only Company Integrity "צריך ממך" on the dashboard.
 *
 * - Fetches GET /api/partner/integrity and parses it strictly (any failure / malformed payload → nothing shown).
 * - An answer is sent ONLY by the explicit "שמור תשובה" click, ONLY to POST /api/partner/integrity/answer, echoing the
 *   question exactly as rendered, with a fresh requestId. No automatic retries, no optimistic change: every control is
 *   disabled while saving, then the surface is re-fetched (the persisted Owner Context is authoritative).
 * - "למדתי…" is shown only when the server saved the answer AND re-read it as applied.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRole } from "@/lib/use-role";
import { parseIntegritySurfaceResponse, type IntegrityQuestionDto, type IntegritySurfaceDto } from "@/lib/partner/integrity/dto";
import { buildIntegrityAnswerAttempt, interpretIntegrityAnswerResponse, INTEGRITY_ERROR_MESSAGE_HE } from "./partner-integrity-answer-client";
import { PartnerIntegrityView } from "./PartnerIntegrityView";

const newRequestId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "");

export default function PartnerIntegritySection({ isMobile }: { isMobile: boolean }) {
  const role = useRole();
  const [surface, setSurface] = useState<IntegritySurfaceDto | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submitting = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/partner/integrity", { cache: "no-store", signal });
      if (!res.ok) { setSurface(null); return; }
      const parsed = parseIntegritySurfaceResponse(await res.json());
      if (!parsed.ok) { console.warn("[partner-integrity] malformed payload — not rendered"); setSurface(null); return; }
      setSurface(parsed.surface);
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") setSurface(null);
    }
  }, []);

  useEffect(() => {
    if (role !== "owner") return;
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [role, load]);

  const save = useCallback(async (q: IntegrityQuestionDto) => {
    if (submitting.current) return;
    const attempt = buildIntegrityAnswerAttempt(q, selected[q.questionId] ?? "", newRequestId());
    if (!attempt) return;
    submitting.current = true;
    setBusy(true);
    setMessage(null);
    let status = 0, body: unknown = null;
    try {
      const res = await fetch(attempt.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(attempt.body), cache: "no-store" });
      status = res.status;
      body = await res.json().catch(() => null);
    } catch { status = 0; }
    const outcome = status ? interpretIntegrityAnswerResponse(status, body, q.subjectLabel) : { ui: "error" as const, messageHe: INTEGRITY_ERROR_MESSAGE_HE };
    await load();
    setSelected({});
    setMessage(outcome.messageHe);
    setBusy(false);
    submitting.current = false;
  }, [selected, load]);

  if (role !== "owner" || !surface) return null;
  return (
    <PartnerIntegrityView surface={surface} isMobile={isMobile} message={message}
      controls={{ busy, selected, onSelect: (q, code) => setSelected((s) => ({ ...s, [q.questionId]: code })), onSave: (q) => void save(q) }} />
  );
}
