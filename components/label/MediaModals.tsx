"use client";

import { useState } from "react";
import type { LabelArtist, LabelMediaRecord } from "@/lib/types";
import { allocationAmountOf, incomeKindOfSource, INCOME_KIND_HE, mediaAllocationsOf, mediaLabelShareByRule, RECORDS_INCOME_KINDS, type RecordsIncomeKind } from "@/lib/records-expense-share";
import {
  BRAND, CARD2, BORDER, TEXT, SUB, MUTED,
  ModalShell, PrimaryBtn, GhostBtn, fieldStyle, labelStyle, fmtMoney, ArtistAvatar,
} from "./labelShared";

export type MediaRec = LabelMediaRecord & { artistId: string; artistName: string };

function StatusPills({ value, onChange }: { value: "התקבל" | "צפוי"; onChange: (v: "התקבל" | "צפוי") => void }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {(["התקבל", "צפוי"] as const).map((s) => {
        const active = s === value;
        const c = s === "התקבל" ? "#34D399" : "#F59E0B";
        return <button key={s} type="button" onClick={() => onChange(s)} style={{ fontSize: 12.5, fontWeight: 700, borderRadius: 100, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit", color: active ? "#fff" : c, background: active ? c : `${c}14`, border: `1px solid ${active ? c : `${c}33`}` }}>{s}</button>;
      })}
    </div>
  );
}

// Create OR edit a media record. Edit of a received record is descriptive-only.
// Allocation model (2026-09-29): ONE income → ONE Finance transaction (full amount, Records) + the artists' allocations by
// the rule (kind + credited label artists). A LEGACY record (allocation_model false, e.g. Mobile1) keeps its stored split.
export function MediaModal({ artists, mode, record, onClose, onSaved }: {
  artists: LabelArtist[]; mode: "create" | "edit"; record?: MediaRec; onClose: () => void; onSaved: () => void;
}) {
  const isEdit = mode === "edit";
  const closed = isEdit && record!.status === "התקבל";   // financially closed → descriptive only
  const legacy = isEdit && !record!.allocationModel;      // a pre-2026-09-29 record: no kind / artists / Finance link
  // one key per modal: a double click / network retry returns the same income (DB key uq_lmi_request_key)
  const [requestKey] = useState<string>(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const [kind, setKind] = useState<RecordsIncomeKind>(record?.incomeKind ?? "DISTRIBUTION");
  // the credited label artists: the first is the income's owner; the rest are co-credited (e.g. Shalev + Avi)
  const [credited, setCredited] = useState<string[]>(() => {
    if (!record) return artists[0]?.id ? [artists[0].id] : [];
    const act = record.allocations.filter((a) => a.status === "active").map((a) => a.artistId);
    return [record.primaryArtistId, ...act.filter((id) => id !== record.primaryArtistId)];
  });

  const artistId = credited[0] ?? "";
  const toggleCredited = (id: string) => setCredited((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const creditedNames = credited.map((id) => artists.find((a) => a.id === id)?.name ?? "").filter(Boolean);
  const plan = mediaAllocationsOf(kind, creditedNames);
  const [gross, setGross] = useState<string>(record ? String(record.grossAmount) : "");
  const [source, setSource] = useState<string>(record?.source ?? "Mobile1");
  const [reportPeriod, setReportPeriod] = useState<string>(record?.reportPeriod ?? "");
  const [receivedDate, setReceivedDate] = useState<string>(record?.receivedDate ?? "");
  const [status, setStatus] = useState<"התקבל" | "צפוי">((record?.status as "התקבל" | "צפוי") ?? "התקבל");
  const [notes, setNotes] = useState<string>(record?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  async function submit() {
    setErr(null);
    if (!isEdit && !artistId) { setErr("יש לבחור אמן"); return; }
    if (!legacy && !closed && plan.status === "UNDEFINED") { setErr(`אין חוק חלוקה להכנסה הזו — ${plan.reasonHe}`); return; }
    if (!closed) {
      const g = Number(gross);
      if (!Number.isFinite(g) || g < 0) { setErr("סכום לא תקין"); return; }
    }
    setBusy(true);
    try {
      let res: Response;
      if (!isEdit) {
        res = await fetch(`/api/label/artists/${artistId}/media`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grossAmount: Number(gross), source: source.trim(), reportPeriod: reportPeriod.trim(), receivedDate: receivedDate || null, status, notes: notes.trim(), incomeKind: kind, creditedArtistIds: credited, requestKey }),
        });
      } else if (closed) {
        // descriptive only
        res = await fetch(`/api/label/media/${record!.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artistId: record!.primaryArtistId, expectedUpdatedAt: record!.updatedAt, source: source.trim(), reportPeriod: reportPeriod.trim(), notes: notes.trim() }),
        });
      } else {
        // expected → full edit (may freeze on →התקבל)
        res = await fetch(`/api/label/media/${record!.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artistId: record!.primaryArtistId, expectedUpdatedAt: record!.updatedAt, grossAmount: Number(gross), source: source.trim(), reportPeriod: reportPeriod.trim(), receivedDate: receivedDate || null, clearReceivedDate: !receivedDate, status, notes: notes.trim(), ...(legacy ? {} : { incomeKind: kind, creditedArtistIds: credited }) }),
        });
      }
      if (res.status === 409) { const d = await res.json().catch(() => null); setConflict(true); setErr(d?.error || "הרשומה עודכנה במקום אחר. יש לרענן ולנסות שוב."); setBusy(false); onSaved(); return; }
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error || "השמירה נכשלה"); setBusy(false); return; }
      onSaved(); onClose();
    } catch { setErr("שגיאת רשת"); setBusy(false); }
  }

  const lockedArtist = isEdit ? artists.find((a) => a.id === record!.primaryArtistId) : null;
  const canEditSplit = !closed && !legacy;   // create, or an expected allocation-model income

  return (
    <ModalShell title={isEdit ? (closed ? "עריכת מדיה (תיאורי בלבד)" : "עריכת מדיה") : "הזנת הכנסת מדיה"} onClose={onClose}>
      {closed && <div style={{ fontSize: 12, color: "#F59E0B", fontWeight: 700, marginBottom: 14 }}>רשומה שהתקבלה סגורה כספית — ניתן לעדכן רק מקור/תקופה/הערה. לתיקון כספי יש לבטל וליצור חדשה.</div>}

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>{canEditSplit ? "אמנים בקרדיט (הראשון = בעל הרשומה)" : "אמן"}</label>
        {isEdit && !canEditSplit ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: CARD2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "9px 12px" }}>
            {lockedArtist && <ArtistAvatar artist={lockedArtist} size={28} />}
            <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{record!.artistName}</span>
          </div>
        ) : artists.length === 0 ? (
          <div style={{ fontSize: 13, color: MUTED }}>אין אמני לייבל.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {artists.map((a) => { const active = credited.includes(a.id); const owner = a.id === artistId; const lockOwner = isEdit && owner; return <button key={a.id} type="button" disabled={lockOwner} onClick={() => toggleCredited(a.id)} style={{ fontSize: 12.5, fontWeight: 700, borderRadius: 100, padding: "6px 13px", cursor: lockOwner ? "default" : "pointer", fontFamily: "inherit", color: active ? "#fff" : SUB, background: active ? BRAND : "rgba(255,255,255,0.04)", border: `1px solid ${active ? BRAND : BORDER}` }}>{a.name}{owner && credited.length > 1 ? " ★" : ""}</button>; })}
          </div>
        )}
      </div>

      {canEditSplit && (
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>סוג הכנסה</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {RECORDS_INCOME_KINDS.map((k) => { const active = k === kind; return <button key={k} type="button" onClick={() => setKind(k)} style={{ fontSize: 12.5, fontWeight: 700, borderRadius: 100, padding: "6px 13px", cursor: "pointer", fontFamily: "inherit", color: active ? "#fff" : SUB, background: active ? BRAND : "rgba(255,255,255,0.04)", border: `1px solid ${active ? BRAND : BORDER}` }}>{INCOME_KIND_HE[k]}</button>; })}
          </div>
        </div>
      )}
      {legacy && <div style={{ fontSize: 12, color: MUTED, marginBottom: 12 }}>רשומה ישנה (לפני מודל החלוקה) — החלוקה ההיסטורית נשמרת כפי שהיא, בלי קישור לכספים.</div>}

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>סכום נטו לחלוקה</label>
        <input type="number" step="0.01" value={gross} onChange={(e) => setGross(e.target.value)} disabled={closed} placeholder="0.00" style={{ ...fieldStyle, opacity: closed ? 0.5 : 1 }} />
        {!closed && Number(gross) > 0 && (() => {
          const g = Number(gross);
          if (legacy) {
            // a LEGACY record keeps the pre-2026-09-29 reading (the rule over the source text)
            const label = mediaLabelShareByRule(source, record!.artistName, g) ?? Math.round((g / 2) * 100) / 100;
            return <div style={{ fontSize: 11, color: MUTED, marginTop: 5 }}>חלק לייבל {fmtMoney(label)} · חלק אמן ברוטו {fmtMoney(Math.round((g - label) * 100) / 100)}</div>;
          }
          if (plan.status === "UNDEFINED") return <div style={{ fontSize: 11.5, color: "#F59E0B", fontWeight: 700, marginTop: 5 }}>אין חוק חלוקה — {plan.reasonHe}</div>;
          const artistsTotal = plan.allocations.reduce((sum, a) => sum + allocationAmountOf(g, a.pct), 0);
          return <div style={{ fontSize: 11, color: MUTED, marginTop: 5, lineHeight: 1.6 }}>
            כספים: הכנסה אחת {fmtMoney(g)} (Records) · Records {fmtMoney(Math.round((g - artistsTotal) * 100) / 100)}
            {plan.allocations.map((a) => <span key={a.artistId}> · {a.name} {a.pct}% = {fmtMoney(allocationAmountOf(g, a.pct))}</span>)}
            {plan.allocations.length === 0 && <span> · בלי זכאות לאמנים</span>}
          </div>;
        })()}
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={labelStyle}>מקור</label>
          <input value={source} onChange={(e) => { setSource(e.target.value); if (!isEdit) setKind(incomeKindOfSource(e.target.value)); }} placeholder="Mobile1" style={fieldStyle} />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={labelStyle}>תקופת דוח</label>
          <input value={reportPeriod} onChange={(e) => setReportPeriod(e.target.value)} placeholder="לדוגמה: 2026-Q1" style={fieldStyle} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={labelStyle}>תאריך קבלה</label>
          <input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} disabled={closed} style={{ ...fieldStyle, opacity: closed ? 0.5 : 1 }} />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={labelStyle}>סטטוס</label>
          {closed ? <div style={{ ...fieldStyle, opacity: 0.6 }}>התקבל</div> : <StatusPills value={status} onChange={setStatus} />}
        </div>
      </div>

      <div style={{ marginBottom: 4 }}>
        <label style={labelStyle}>הערה</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="אופציונלי" style={fieldStyle} />
      </div>

      {err && <div style={{ color: conflict ? "#F59E0B" : "#F87171", fontSize: 12.5, fontWeight: 700, margin: "8px 0 2px" }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <GhostBtn onClick={onClose}>{conflict ? "סגור" : "ביטול"}</GhostBtn>
        {!conflict && <PrimaryBtn onClick={submit} disabled={busy}>{busy ? "שומר…" : isEdit ? "שמור" : "הוסף"}</PrimaryBtn>}
      </div>
    </ModalShell>
  );
}

// Cancel: expected → mark בוטל; received → append a reversal.
export function MediaCancelModal({ record, onClose, onSaved }: { record: MediaRec; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const received = record.status === "התקבל";

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/label/media/${record.id}/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artistId: record.primaryArtistId, expectedUpdatedAt: record.updatedAt }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error || "הביטול נכשל"); setBusy(false); onSaved(); return; }
      onSaved(); onClose();
    } catch { setErr("שגיאת רשת"); setBusy(false); }
  }

  return (
    <ModalShell title="ביטול רשומת מדיה" onClose={onClose}>
      <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.7, marginBottom: 8 }}>
        {received
          ? <>ביטול רשומה שהתקבלה יוצר <b style={{ color: TEXT }}>רשומת היפוך</b> (המקורית נשמרת ללא שינוי); הקיזוז וחלק הלייבל מתנטרלים.</>
          : <>הרשומה הצפויה תסומן <b style={{ color: TEXT }}>בוטל</b> (נשמרת, ללא קיזוז).</>}
      </div>
      {record.allocationModel && <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.7, marginBottom: 8 }}>
        זכאויות האמנים ביומן נשמרות ב-0 עם סיבה (לא נמחקות). {record.financeTransactionId ? "תנועת הכספים: אם נוצרה ע״י המדיה — מסומנת בוטל (נשמרת); אם קושרה ע״י הבעלים — לא משתנה." : ""}
      </div>}
      <div style={{ fontSize: 12.5, color: MUTED }}>{record.source} · {fmtMoney(record.grossAmount)} · {record.reportPeriod || "—"}</div>
      {err && <div style={{ color: "#F87171", fontSize: 12.5, fontWeight: 700, margin: "10px 0 2px" }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <GhostBtn onClick={onClose}>חזרה</GhostBtn>
        <PrimaryBtn onClick={submit} disabled={busy}>{busy ? "מבטל…" : received ? "צור היפוך" : "בטל רשומה"}</PrimaryBtn>
      </div>
    </ModalShell>
  );
}
