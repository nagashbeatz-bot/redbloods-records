"use client";

import { useState } from "react";
import type { LabelArtist, LabelMediaRecord } from "@/lib/types";
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
export function MediaModal({ artists, mode, record, onClose, onSaved }: {
  artists: LabelArtist[]; mode: "create" | "edit"; record?: MediaRec; onClose: () => void; onSaved: () => void;
}) {
  const isEdit = mode === "edit";
  const closed = isEdit && record!.status === "התקבל";   // financially closed → descriptive only

  const [artistId, setArtistId] = useState<string>(record?.artistId ?? (artists[0]?.id ?? ""));
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
          body: JSON.stringify({ grossAmount: Number(gross), source: source.trim(), reportPeriod: reportPeriod.trim(), receivedDate: receivedDate || null, status, notes: notes.trim() }),
        });
      } else if (closed) {
        // descriptive only
        res = await fetch(`/api/label/media/${record!.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artistId: record!.artistId, expectedUpdatedAt: record!.updatedAt, source: source.trim(), reportPeriod: reportPeriod.trim(), notes: notes.trim() }),
        });
      } else {
        // expected → full edit (may freeze on →התקבל)
        res = await fetch(`/api/label/media/${record!.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artistId: record!.artistId, expectedUpdatedAt: record!.updatedAt, grossAmount: Number(gross), source: source.trim(), reportPeriod: reportPeriod.trim(), receivedDate: receivedDate || null, clearReceivedDate: !receivedDate, status, notes: notes.trim() }),
        });
      }
      if (res.status === 409) { const d = await res.json().catch(() => null); setConflict(true); setErr(d?.error || "הרשומה עודכנה במקום אחר. יש לרענן ולנסות שוב."); setBusy(false); onSaved(); return; }
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error || "השמירה נכשלה"); setBusy(false); return; }
      onSaved(); onClose();
    } catch { setErr("שגיאת רשת"); setBusy(false); }
  }

  const lockedArtist = isEdit ? artists.find((a) => a.id === record!.artistId) : null;

  return (
    <ModalShell title={isEdit ? (closed ? "עריכת מדיה (תיאורי בלבד)" : "עריכת מדיה") : "הזנת הכנסת מדיה"} onClose={onClose}>
      {closed && <div style={{ fontSize: 12, color: "#F59E0B", fontWeight: 700, marginBottom: 14 }}>רשומה שהתקבלה סגורה כספית — ניתן לעדכן רק מקור/תקופה/הערה. לתיקון כספי יש לבטל וליצור חדשה.</div>}

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>אמן</label>
        {isEdit ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: CARD2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "9px 12px" }}>
            {lockedArtist && <ArtistAvatar artist={lockedArtist} size={28} />}
            <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{record!.artistName}</span>
          </div>
        ) : artists.length === 0 ? (
          <div style={{ fontSize: 13, color: MUTED }}>אין אמני לייבל.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {artists.map((a) => { const active = a.id === artistId; return <button key={a.id} type="button" onClick={() => setArtistId(a.id)} style={{ fontSize: 12.5, fontWeight: 700, borderRadius: 100, padding: "6px 13px", cursor: "pointer", fontFamily: "inherit", color: active ? "#fff" : SUB, background: active ? BRAND : "rgba(255,255,255,0.04)", border: `1px solid ${active ? BRAND : BORDER}` }}>{a.name}</button>; })}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>סכום נטו לחלוקה</label>
        <input type="number" step="0.01" value={gross} onChange={(e) => setGross(e.target.value)} disabled={closed} placeholder="0.00" style={{ ...fieldStyle, opacity: closed ? 0.5 : 1 }} />
        {!closed && Number(gross) > 0 && <div style={{ fontSize: 11, color: MUTED, marginTop: 5 }}>חלק לייבל {fmtMoney(Math.round((Number(gross) / 2) * 100) / 100)} · חלק אמן ברוטו {fmtMoney(Number(gross) - Math.round((Number(gross) / 2) * 100) / 100)}</div>}
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={labelStyle}>מקור</label>
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Mobile1" style={fieldStyle} />
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
        body: JSON.stringify({ artistId: record.artistId, expectedUpdatedAt: record.updatedAt }),
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
      <div style={{ fontSize: 12.5, color: MUTED }}>{record.source} · {fmtMoney(record.grossAmount)} · {record.reportPeriod || "—"}</div>
      {err && <div style={{ color: "#F87171", fontSize: 12.5, fontWeight: 700, margin: "10px 0 2px" }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <GhostBtn onClick={onClose}>חזרה</GhostBtn>
        <PrimaryBtn onClick={submit} disabled={busy}>{busy ? "מבטל…" : received ? "צור היפוך" : "בטל רשומה"}</PrimaryBtn>
      </div>
    </ModalShell>
  );
}
