"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

interface IntakeItem {
  path: string; name: string; size?: number;
  category: string; stemType?: string; targetName: string; targetLabel: string;
}
type Step = "input" | "scanning" | "preview" | "moving" | "done";

const CAT_COLOR: Record<string, string> = {
  "מאסטר": "#EF4444", "גרסת הופעה": "#F59E0B", "אקפלה": "#A855F7",
  "אינסטרומנטל": "#3B82F6", "ערוצים": "#10B981", "אחר": "#6B7280",
};
const CAT_ORDER = ["מאסטר", "גרסת הופעה", "אקפלה", "אינסטרומנטל", "ערוצים", "אחר"];

function fmtSize(b?: number): string {
  if (!b) return "";
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${Math.round(b / 1e3)} KB`;
  return `${b} B`;
}

export default function StevenIntakeModal({ projectId, projectName, onClose, onDone }: {
  projectId: string; projectName: string; onClose: () => void; onDone: () => void;
}) {
  const [step,   setStep]   = useState<Step>("input");
  const [url,    setUrl]    = useState("");
  const [items,  setItems]  = useState<IntakeItem[]>([]);
  const [error,  setError]  = useState<string | null>(null);
  const [result, setResult] = useState<{ moved: number; total: number; results: { name: string; ok: boolean; error?: string }[] } | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  async function scan() {
    if (!url.trim()) { setError("הדבק לינק לתיקיית Dropbox של Steven"); return; }
    setStep("scanning"); setError(null);
    try {
      const res = await fetch("/api/dropbox/intake", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan", url: url.trim(), projectName }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "שגיאת סריקה"); setStep("input"); return; }
      setItems(d.items ?? []); setStep("preview");
    } catch { setError("שגיאת רשת"); setStep("input"); }
  }

  async function move() {
    setStep("moving"); setError(null);
    try {
      const res = await fetch("/api/dropbox/intake", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move", projectId, items }),
      });
      const d = await res.json();
      if (res.status >= 500) { setError(d.error ?? "שגיאת שרת"); setStep("preview"); return; }
      setResult({ moved: d.moved ?? 0, total: d.total ?? items.length, results: d.results ?? [] });
      setStep("done");
      if ((d.moved ?? 0) > 0) onDone();
    } catch { setError("שגיאת רשת"); setStep("preview"); }
  }

  const grouped = CAT_ORDER
    .map((cat) => ({ cat, list: items.filter((i) => i.category === cat) }))
    .filter((g) => g.list.length > 0);

  const inp: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", background: "#0D0D0D", border: "1px solid #2A2A2A",
    borderRadius: 10, color: "#E8E8E8", fontSize: 13, padding: "11px 13px", outline: "none", fontFamily: "inherit", direction: "ltr",
  };
  const btnPrimary: React.CSSProperties = {
    padding: "11px 18px", borderRadius: 10, border: "none", background: "#DC2626", color: "#fff",
    fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 14px rgba(220,38,38,0.4)",
  };
  const btnGhost: React.CSSProperties = {
    padding: "11px 18px", borderRadius: 10, border: "1px solid #2A2A2A", background: "transparent",
    color: "#999", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  };

  const modal = (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 100001, background: "rgba(0,0,0,0.78)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div onClick={(e) => e.stopPropagation()} dir="rtl" style={{
        background: "#141414", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 20,
        width: 560, maxWidth: "96vw", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.9)",
        padding: "22px 24px 20px", fontFamily: "inherit",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#F5F5F5" }}>קליטה מ-Steven</div>
            <div style={{ fontSize: 12, color: "#777", marginTop: 3 }}>{projectName}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        {/* ── Step: input ── */}
        {step === "input" && (
          <>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#999", display: "block", marginBottom: 8 }}>
              הדבק לינק לתיקיית Dropbox של Steven
            </label>
            <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.dropbox.com/scl/fo/..."
              onKeyDown={(e) => { if (e.key === "Enter") scan(); }} style={inp} />
            <div style={{ fontSize: 11, color: "#555", marginTop: 8, lineHeight: 1.6 }}>
              נסרקת רק התיקייה הזו. אפשר גם להדביק את ה-<span style={{ color: "#999" }}>home URL</span> של התיקייה (dropbox.com/home/...) — מומלץ לתיקייה שאתה יצרת ושיתפת. ברירת המחדל: <b style={{ color: "#999" }}>העברה</b> לתיקיית הפרויקט.
            </div>
            {error && <div style={{ fontSize: 12, color: "#EF4444", marginTop: 12 }}>{error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={onClose} style={btnGhost}>ביטול</button>
              <button onClick={scan} style={{ ...btnPrimary, marginInlineStart: "auto" }}>↓ סרוק תיקייה</button>
            </div>
          </>
        )}

        {/* ── Step: scanning / moving spinners ── */}
        {(step === "scanning" || step === "moving") && (
          <div style={{ textAlign: "center", padding: "36px 0", color: "#888" }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
            {step === "scanning" ? "סורק את התיקייה ומזהה קבצים..." : "מעביר קבצים לתיקיית הפרויקט..."}
          </div>
        )}

        {/* ── Step: preview ── */}
        {step === "preview" && (
          <>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
              נמצאו <b style={{ color: "#F5F5F5" }}>{items.length}</b> קבצים. בדוק את הזיהוי והיעד לפני האישור.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 16 }}>
              {grouped.map((g) => (
                <div key={g.cat}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: CAT_COLOR[g.cat] }} />
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: "#E8E8E8" }}>{g.cat}</span>
                    <span style={{ fontSize: 11, color: "#555" }}>({g.list.length})</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {g.list.map((it, i) => (
                      <div key={`${it.path}-${i}`} style={{
                        background: "#161616", border: "1px solid #242424", borderRadius: 9, padding: "8px 11px",
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                          <span style={{ fontSize: 12, color: "#C0C0C0", fontWeight: 600, direction: "ltr", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                          <span style={{ fontSize: 10, color: "#555", flexShrink: 0 }}>{fmtSize(it.size)}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#777", marginTop: 3, direction: "ltr" }}>
                          <span style={{ color: "#555" }}>→ </span>{it.targetName}
                          {it.stemType ? <span style={{ color: CAT_COLOR["ערוצים"] }}>{`  ·  ${it.stemType}`}</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 14 }}>
              ⚠ הקבצים יועברו (move) מתיקיית Steven לתיקיית המסירה של הפרויקט.
            </div>
            {error && <div style={{ fontSize: 12, color: "#EF4444", marginBottom: 12 }}>{error}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setStep("input")} style={btnGhost}>חזור</button>
              <button onClick={move} style={{ ...btnPrimary, marginInlineStart: "auto" }}>✓ אשר העברה</button>
            </div>
          </>
        )}

        {/* ── Step: done ── */}
        {step === "done" && result && (
          <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
            <div style={{ fontSize: 34, marginBottom: 10, color: result.moved === result.total ? "#10B981" : "#F59E0B" }}>
              {result.moved === result.total ? "✓" : "⚠"}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#F5F5F5", marginBottom: 6 }}>
              {result.moved === result.total ? "ההעברה הושלמה בהצלחה!" : "ההעברה הושלמה חלקית"}
            </div>
            <div style={{ fontSize: 12.5, color: "#999", marginBottom: 14 }}>
              {result.moved} מתוך {result.total} קבצים הועברו לתיקיית הפרויקט. זמינים בטאב "קבצים".
            </div>
            {result.results.some((r) => !r.ok) && (
              <div style={{ textAlign: "right", background: "#161616", border: "1px solid #242424", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
                {result.results.filter((r) => !r.ok).map((r, i) => (
                  <div key={i} style={{ fontSize: 11, color: "#EF4444", direction: "ltr" }}>✗ {r.name} — {r.error}</div>
                ))}
              </div>
            )}
            <button onClick={onClose} style={{ ...btnPrimary, width: "100%" }}>סגור</button>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
