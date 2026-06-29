"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

interface IntakeItem {
  path: string; name: string; size?: number;
  category: string; targetName: string; targetDir?: string; targetLabel: string;
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
  const [diag,   setDiag]   = useState<unknown>(null);
  const [result, setResult] = useState<{ moved: number; total: number; results: { name: string; ok: boolean; error?: string }[]; deliveryPath?: string } | null>(null);

  // Done-screen actions (reuse the existing /api/dropbox/folder-link endpoint).
  const [linkBusy,  setLinkBusy]  = useState<"" | "copy" | "open">("");
  const [linkState, setLinkState] = useState<"" | "copied" | "notpublic">("");
  const [linkErr,   setLinkErr]   = useState<string | null>(null);
  const [folderLink, setFolderLink] = useState<string | null>(null);

  // Source folder of the scanned link (e.g. the FINAL DELIVERABLES folder) — used
  // to optionally delete it after a fully successful intake.
  const [sourcePath, setSourcePath] = useState<string>("");
  const [srcConfirm, setSrcConfirm] = useState(false);
  const [srcBusy,    setSrcBusy]    = useState(false);
  const [srcState,   setSrcState]   = useState<"" | "deleted" | "hasfiles">("");
  const [srcErr,     setSrcErr]     = useState<string | null>(null);

  async function deleteSourceFolder() {
    if (!sourcePath || srcBusy) return;
    setSrcBusy(true); setSrcErr(null);
    try {
      const res = await fetch("/api/dropbox/intake", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-source", sourcePath }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "failed");
      if (d.hasFiles) { setSrcState("hasfiles"); setSrcConfirm(false); return; }
      if (d.ok) { setSrcState("deleted"); setSrcConfirm(false); }
    } catch (e) {
      console.error("[intake] delete source folder failed:", e);
      setSrcErr("לא הצלחנו למחוק את תיקיית המקור. נסה שוב.");
    } finally { setSrcBusy(false); }
  }

  async function fetchFolderLink(): Promise<{ shareLink: string; visibility?: string }> {
    const res = await fetch("/api/dropbox/folder-link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: result?.deliveryPath }),
    });
    const d = await res.json();
    if (!res.ok || !d.ok || !d.shareLink) throw new Error(d.error || "no-link");
    return { shareLink: d.shareLink, visibility: d.visibility };
  }

  async function copyClientLink() {
    if (!result?.deliveryPath || linkBusy) return;
    setLinkBusy("copy"); setLinkErr(null); setLinkState("");
    try {
      const { shareLink, visibility } = await fetchFolderLink();
      await navigator.clipboard.writeText(shareLink);
      setLinkState(visibility === "public" ? "copied" : "notpublic");
      setTimeout(() => setLinkState(""), 6000);
    } catch (e) {
      const detail = e instanceof Error && e.message && e.message !== "no-link" ? ` (${e.message})` : "";
      setLinkErr(`לא ניתן ליצור לינק ללקוח${detail}`);
    } finally { setLinkBusy(""); }
  }

  async function openDeliveryFolder() {
    if (!result?.deliveryPath || linkBusy) return;
    setLinkBusy("open"); setLinkErr(null); setFolderLink(null);
    try {
      const { shareLink } = await fetchFolderLink();
      const w = window.open(shareLink, "_blank", "noopener,noreferrer");
      if (!w) setFolderLink(shareLink); // popup blocked → show a manual link
    } catch (e) {
      const detail = e instanceof Error && e.message && e.message !== "no-link" ? ` (${e.message})` : "";
      setLinkErr(`לא ניתן לפתוח את תיקיית Dropbox${detail}`);
    } finally { setLinkBusy(""); }
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  async function scan() {
    if (!url.trim()) { setError("הדבק לינק לתיקיית Dropbox של Steven"); return; }
    setStep("scanning"); setError(null); setDiag(null);
    try {
      const res = await fetch("/api/dropbox/intake", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan", url: url.trim(), projectName }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "שגיאת סריקה"); setDiag(d.diagnostic ?? null); setStep("input"); return; }
      setItems(d.items ?? []); setSourcePath(d.sourcePath ?? ""); setStep("preview");
    } catch { setError("שגיאת רשת"); setStep("input"); }
  }

  async function runDiag() {
    setError(null); setDiag(null);
    try {
      const res = await fetch("/api/dropbox/intake", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "diag" }),
      });
      const d = await res.json();
      setDiag(d);
    } catch { setError("שגיאת רשת"); }
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
      setResult({ moved: d.moved ?? 0, total: d.total ?? items.length, results: d.results ?? [], deliveryPath: d.deliveryPath });
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
            {diag != null && (
              <pre style={{
                marginTop: 10, maxHeight: 200, overflow: "auto", background: "#0D0D0D", border: "1px solid #242424",
                borderRadius: 8, padding: "10px 12px", fontSize: 10.5, color: "#9A9AA8", direction: "ltr",
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>{JSON.stringify(diag, null, 2)}</pre>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center" }}>
              <button onClick={onClose} style={btnGhost}>ביטול</button>
              <button onClick={runDiag} style={{ ...btnGhost, marginInlineStart: "auto" }} title="הצג אילו תיקיות ה-Dropbox רואה">🔎 בדוק חיבור</button>
              <button onClick={scan} style={btnPrimary}>↓ סרוק תיקייה</button>
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
                          <span style={{ color: "#555" }}>→ </span>
                          {it.targetDir ? <span style={{ color: CAT_COLOR["ערוצים"] }}>{`${it.targetDir}/`}</span> : null}
                          {it.targetName}
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
              {result.moved} מתוך {result.total} קבצים הועברו לתיקיית המסירה. זמינים בטאב "קבצים".
            </div>

            {/* Short summary of what moved, by category */}
            {grouped.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 16 }}>
                {grouped.map((g) => (
                  <span key={g.cat} style={{
                    display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700,
                    color: "#CFCFCF", background: "#161616", border: "1px solid #242424", borderRadius: 999, padding: "5px 11px",
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: CAT_COLOR[g.cat] }} />
                    {g.cat} <span style={{ color: "#666" }}>({g.list.length})</span>
                  </span>
                ))}
              </div>
            )}

            {result.results.some((r) => !r.ok) && (
              <div style={{ textAlign: "right", background: "#161616", border: "1px solid #242424", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
                {result.results.filter((r) => !r.ok).map((r, i) => (
                  <div key={i} style={{ fontSize: 11, color: "#EF4444", direction: "ltr" }}>✗ {r.name} — {r.error}</div>
                ))}
              </div>
            )}

            {/* Delivery folder actions (reuse existing folder-link endpoint) */}
            {result.deliveryPath && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={copyClientLink} disabled={!!linkBusy} style={{ ...btnGhost, flex: 1, opacity: linkBusy ? 0.6 : 1 }}>
                    {linkBusy === "copy" ? "מכין…" : "⎘ העתק לינק ללקוח"}
                  </button>
                  <button onClick={openDeliveryFolder} disabled={!!linkBusy} style={{ ...btnGhost, flex: 1, opacity: linkBusy ? 0.6 : 1 }}>
                    {linkBusy === "open" ? "פותח…" : "פתח תיקיית מסירה ↗"}
                  </button>
                </div>
                {linkState === "copied"   && <div style={{ fontSize: 11.5, color: "#10B981" }}>✓ לינק ללקוח הועתק</div>}
                {linkState === "notpublic" && <div style={{ fontSize: 11.5, color: "#F59E0B" }}>הועתק, אך הלינק אינו ציבורי — בדוק הגדרות שיתוף ב-Dropbox</div>}
                {linkErr && <div style={{ fontSize: 11.5, color: "#EF4444" }}>{linkErr}</div>}
                {folderLink && (
                  <a href={folderLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, color: "#3B82F6", direction: "ltr", wordBreak: "break-all" }}>
                    {folderLink}
                  </a>
                )}
              </div>
            )}

            {/* Delete the original FINAL DELIVERABLES source folder — only after a
                FULLY successful intake, and only when the scanned folder is itself
                named FINAL DELIVERABLES (never a parent). */}
            {result.moved === result.total && result.total > 0 &&
             sourcePath.replace(/\/+$/, "").split("/").pop()?.trim().toLowerCase() === "final deliverables" && (
              srcState === "deleted" ? (
                <div style={{ fontSize: 11.5, color: "#10B981", marginBottom: 12 }}>✓ תיקיית FINAL DELIVERABLES נמחקה מ-Dropbox</div>
              ) : srcConfirm ? (
                <div style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "11px 13px", marginBottom: 12, display: "flex", flexDirection: "column", gap: 9 }}>
                  <div style={{ fontSize: 12, color: "#E8E8E8", lineHeight: 1.6 }}>
                    תיקיית FINAL DELIVERABLES המקורית תימחק מ-Dropbox. הקבצים שנקלטו כבר נמצאים בתיקיית המסירה של הפרויקט. להמשיך?
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setSrcConfirm(false)} disabled={srcBusy} style={{ ...btnGhost, flex: 1 }}>ביטול</button>
                    <button onClick={deleteSourceFolder} disabled={srcBusy} style={{ flex: 1, padding: "11px 18px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.5)", background: "rgba(239,68,68,0.15)", color: "#F87171", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", opacity: srcBusy ? 0.6 : 1 }}>{srcBusy ? "מוחק…" : "מחק"}</button>
                  </div>
                </div>
              ) : (
                <>
                  <button onClick={() => { setSrcErr(null); setSrcConfirm(true); }} style={{ width: "100%", padding: "11px 18px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.08)", color: "#F87171", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginBottom: srcState === "hasfiles" || srcErr ? 8 : 12 }}>🗑 מחק תיקיית FINAL DELIVERABLES</button>
                  {srcState === "hasfiles" && <div style={{ fontSize: 11.5, color: "#F59E0B", marginBottom: 12 }}>התיקייה עדיין מכילה קבצים שלא נקלטו ולכן לא נמחקה</div>}
                  {srcErr && <div style={{ fontSize: 11.5, color: "#EF4444", marginBottom: 12 }}>{srcErr}</div>}
                </>
              )
            )}

            <button onClick={onClose} style={{ ...btnPrimary, width: "100%" }}>סגור</button>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
