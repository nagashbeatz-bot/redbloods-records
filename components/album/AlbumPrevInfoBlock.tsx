"use client";

import { useEffect, useState, useCallback } from "react";
import type { AlbumPrevInfo, AlbumPrevInfoRow } from "@/lib/types";

/**
 * "מידע קודם" — a manual, HISTORICAL per-song cost table (imported from Monday)
 * for a single album/EP. Display + edit only; stored in settings via
 * /api/album-prev-info. It creates NO transactions and never feeds any canonical
 * Finance / Dashboard / Insights / Agent calculation. Total-with-mix and balance
 * are derived here at render time and never persisted.
 */

interface Props {
  projectId: string;
  projectName: string;
  accentColor: string;
}

const GRID = "40px minmax(120px,1.7fr) 1fr 1fr 1fr 1fr 1fr 34px";
const fmt = (n: number) => `₪${(n || 0).toLocaleString("he-IL")}`;
const newRow = (): AlbumPrevInfoRow => ({
  id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()),
  name: "", costWithoutMix: 0, mixMaster: 0, paid: 0,
});

export default function AlbumPrevInfoBlock({ projectId, projectName, accentColor }: Props) {
  const [open, setOpen]       = useState(false);
  const [loaded, setLoaded]   = useState(false);
  const [rows, setRows]       = useState<AlbumPrevInfoRow[]>([]);
  const [note, setNote]       = useState("");
  const [saving, setSaving]   = useState(false);
  const [dirty, setDirty]     = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Lazy-load on first expand.
  useEffect(() => {
    if (!open || loaded) return;
    fetch(`/api/album-prev-info?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d: AlbumPrevInfo) => {
        setRows(Array.isArray(d?.rows) ? d.rows : []);
        setNote(typeof d?.note === "string" ? d.note : "");
        setSavedAt(d?.updatedAt ?? null);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [open, loaded, projectId]);

  const patchRow = useCallback((id: string, field: keyof AlbumPrevInfoRow, value: string) => {
    setRows((prev) => prev.map((r) => r.id === id
      ? { ...r, [field]: field === "name" ? value : (value === "" ? 0 : Number(value)) }
      : r));
    setDirty(true);
  }, []);

  const addRow    = () => { setRows((p) => [...p, newRow()]); setDirty(true); };
  const removeRow = (id: string) => { setRows((p) => p.filter((r) => r.id !== id)); setDirty(true); };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/album-prev-info?projectId=${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, note }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d as { error?: string }).error || "שמירה נכשלה");
      setSavedAt((d as AlbumPrevInfo).updatedAt ?? new Date().toISOString());
      setDirty(false);
    } catch {
      /* keep dirty so the user can retry */
    } finally {
      setSaving(false);
    }
  };

  const total   = (r: AlbumPrevInfoRow) => (Number(r.costWithoutMix) || 0) + (Number(r.mixMaster) || 0);
  const balance = (r: AlbumPrevInfoRow) => total(r) - (Number(r.paid) || 0);
  const sum = (f: (r: AlbumPrevInfoRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const tCost = sum((r) => Number(r.costWithoutMix) || 0);
  const tMix  = sum((r) => Number(r.mixMaster) || 0);
  const tTot  = sum(total);
  const tPaid = sum((r) => Number(r.paid) || 0);
  const tBal  = sum(balance);

  const cell: React.CSSProperties = { padding: "9px 10px", fontSize: 12.5, color: "#E6E6E6", display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0 };
  const head: React.CSSProperties = { ...cell, fontSize: 11, fontWeight: 800, color: "#8A8A8A", background: "#141414" };
  const inp = (w = "100%"): React.CSSProperties => ({ width: w, boxSizing: "border-box", background: "#111", border: "1px solid #2A2A2A", borderRadius: 7, color: "#EEE", fontSize: 12.5, padding: "6px 8px", fontFamily: "inherit", outline: "none", textAlign: "center" });

  return (
    <div style={{ background: "#1A1A1A", border: "1px solid #252525", borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
      {/* Toggle header */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", background: "transparent", border: "none", cursor: "pointer",
          fontFamily: "inherit", color: "#E0E0E0", direction: "rtl",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
          🕑 מידע קודם
        </span>
        <span style={{ fontSize: 12, color: "#666" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 16px 16px", direction: "rtl" }}>
          <div style={{ fontSize: 11, color: "#666", marginBottom: 12 }}>
            מידע היסטורי שהועבר ממערכת Monday עבור <b style={{ color: accentColor }}>{projectName}</b>. אינו משפיע על החישובים הכספיים במערכת.
          </div>

          {!loaded ? (
            <div style={{ padding: "24px 0", textAlign: "center", color: "#555", fontSize: 12 }}>טוען…</div>
          ) : (
            <>
              <div style={{ border: "1px solid #242424", borderRadius: 10, overflow: "hidden" }}>
                {/* Header */}
                <div style={{ display: "grid", gridTemplateColumns: GRID }}>
                  <div style={head}>#</div>
                  <div style={{ ...head, justifyContent: "flex-start" }}>שם שיר</div>
                  <div style={head}>עלות ללא מיקס</div>
                  <div style={head}>מיקס + מאסטר</div>
                  <div style={head}>סה״כ כולל מיקס</div>
                  <div style={head}>שולם</div>
                  <div style={head}>יתרה</div>
                  <div style={head} />
                </div>
                {/* Rows */}
                {rows.map((r, i) => (
                  <div key={r.id} style={{ display: "grid", gridTemplateColumns: GRID, borderTop: "1px solid #1E1E1E" }}>
                    <div style={{ ...cell, color: "#666" }}>{i + 1}</div>
                    <div style={{ ...cell, justifyContent: "stretch" }}>
                      <input value={r.name} onChange={(e) => patchRow(r.id, "name", e.target.value)} placeholder="שם שיר" style={{ ...inp(), textAlign: "right" }} />
                    </div>
                    <div style={cell}><input type="number" min={0} value={r.costWithoutMix || ""} onChange={(e) => patchRow(r.id, "costWithoutMix", e.target.value)} placeholder="0" style={inp()} /></div>
                    <div style={cell}><input type="number" min={0} value={r.mixMaster || ""} onChange={(e) => patchRow(r.id, "mixMaster", e.target.value)} placeholder="0" style={inp()} /></div>
                    <div style={{ ...cell, color: accentColor, fontWeight: 700 }}>{fmt(total(r))}</div>
                    <div style={cell}><input type="number" min={0} value={r.paid || ""} onChange={(e) => patchRow(r.id, "paid", e.target.value)} placeholder="0" style={inp()} /></div>
                    <div style={{ ...cell, color: balance(r) > 0 ? "#EF4444" : "#22c55e", fontWeight: 700 }}>{fmt(balance(r))}</div>
                    <div style={cell}>
                      <button onClick={() => removeRow(r.id)} title="מחק שורה" style={{ background: "none", border: "none", color: "#5A5A5A", cursor: "pointer", fontSize: 13 }}>🗑</button>
                    </div>
                  </div>
                ))}
                {rows.length === 0 && (
                  <div style={{ padding: "20px 0", textAlign: "center", color: "#555", fontSize: 12, borderTop: "1px solid #1E1E1E" }}>אין שורות עדיין — הוסף שיר</div>
                )}
                {/* Totals */}
                {rows.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: GRID, borderTop: "2px solid #2A2A2A", background: "#151515" }}>
                    <div style={{ ...cell }} />
                    <div style={{ ...cell, justifyContent: "flex-start", fontWeight: 800, color: accentColor }}>סה״כ לאלבום</div>
                    <div style={{ ...cell, fontWeight: 800 }}>{fmt(tCost)}</div>
                    <div style={{ ...cell, fontWeight: 800 }}>{fmt(tMix)}</div>
                    <div style={{ ...cell, fontWeight: 800, color: accentColor }}>{fmt(tTot)}</div>
                    <div style={{ ...cell, fontWeight: 800 }}>{fmt(tPaid)}</div>
                    <div style={{ ...cell, fontWeight: 800, color: tBal > 0 ? "#EF4444" : "#22c55e" }}>{fmt(tBal)}</div>
                    <div style={cell} />
                  </div>
                )}
              </div>

              {/* Note */}
              <label style={{ display: "block", marginTop: 14 }}>
                <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#777", marginBottom: 6 }}>הערה</span>
                <textarea value={note} onChange={(e) => { setNote(e.target.value); setDirty(true); }} rows={2} placeholder="למשל: המידע נלקח ממערכת Monday מתאריך…"
                  style={{ width: "100%", boxSizing: "border-box", background: "#111", border: "1px solid #2A2A2A", borderRadius: 9, color: "#EEE", fontSize: 12.5, padding: "9px 11px", fontFamily: "inherit", outline: "none", resize: "vertical" }} />
              </label>

              {/* Actions */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                <button onClick={addRow} style={{ fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", borderRadius: 8, padding: "8px 14px", border: `1px solid ${accentColor}55`, background: `${accentColor}14`, color: accentColor }}>
                  + הוסף שיר
                </button>
                <button onClick={save} disabled={saving || !dirty} style={{ fontSize: 12, fontWeight: 800, fontFamily: "inherit", cursor: saving || !dirty ? "default" : "pointer", borderRadius: 8, padding: "8px 18px", border: "none", background: (saving || !dirty) ? "#2A2A2A" : "#22c55e", color: (saving || !dirty) ? "#666" : "#04120B" }}>
                  {saving ? "שומר…" : "שמור מידע קודם"}
                </button>
                {!dirty && savedAt && <span style={{ fontSize: 11, color: "#555" }}>נשמר ✓</span>}
                {dirty && <span style={{ fontSize: 11, color: "#F59E0B" }}>יש שינויים שלא נשמרו</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
