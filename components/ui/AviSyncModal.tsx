"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AVI_ARTIST_ID } from "@/lib/roles";

/**
 * Owner-facing confirm step shown AFTER a Projects audio upload succeeded, and
 * only when the project's primary artist is Avi Molla.
 *
 * Nothing happens until the owner presses "כן, עדכן את אבי":
 *   confirm → POST project-link (manifest reference to the file ALREADY uploaded,
 *   no second copy anywhere) → only if that returns ok, POST the EXISTING
 *   .../sketches/{id}/notify route (the same one behind the "שלח התראה לאבי"
 *   button). "לא עכשיו" closes and fires no request at all.
 *
 * The target sketch is decided by an EXACT project-name ↔ sketch-title match
 * resolved server-side. When there is no single match the owner picks
 * explicitly — this component never guesses.
 */

const BRAND = "#DC2626";
const CARD = "#141415";
const BDR = "rgba(255,255,255,0.10)";
const TEXT = "#F2F2F2";
const TEXT2 = "#A0A0A0";

interface SketchOption { id: string; title: string }
interface LinkInfo {
  isAviProject: boolean;
  projectName?: string;
  match?: { id: string; title: string; latestVersion: number } | null;
  ambiguous?: boolean;
  sketches?: SketchOption[];
}

interface Props {
  projectId: string;
  projectName: string;
  /** The Dropbox path the upload just returned. The server re-verifies it. */
  dropboxPath: string;
  onClose: () => void;
}

const API = `/api/label/artists/${AVI_ARTIST_ID}`;

export default function AviSyncModal({ projectId, projectName, dropboxPath, onClose }: Props) {
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [phase, setPhase] = useState<"loading" | "ask" | "working" | "done" | "failed">("loading");
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  /** "" = create a new sketch named after the project; otherwise an existing id. */
  const [target, setTarget] = useState<string>("");

  // onClose comes from an inline arrow in the parent, so its identity changes on
  // every parent render. Kept in a ref so the lookup effect below depends on the
  // projectId ALONE and cannot re-fire on an unrelated re-render.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  // Ask the server what this project maps to. Read-only — no manifest write,
  // no push. Runs once per projectId (and only ever from a successful upload's
  // onload handler, so a page refresh cannot reach it at all).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API}/sketches/project-link?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
        const d = (await r.json().catch(() => ({}))) as LinkInfo & { error?: string };
        if (!alive) return;
        if (!r.ok) { setErr(d.error ?? "לא ניתן לבדוק את הספרייה של אבי"); setPhase("failed"); return; }
        if (!d.isAviProject) { closeRef.current(); return; }
        setInfo(d);
        setTarget(d.match?.id ?? "");
        setPhase("ask");
      } catch {
        if (alive) { setErr("שגיאת רשת, נסה שוב"); setPhase("failed"); }
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const close = useCallback(() => { if (phase !== "working") onClose(); }, [phase, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // The ONLY path that writes anything. Link first; push strictly after the
  // link came back ok, so a failed link can never produce a notification.
  const confirm = async () => {
    if (phase === "working") return; // one click = one link + one push
    setPhase("working"); setErr(null); setWarn(null);
    try {
      const linkRes = await fetch(`${API}/sketches/project-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          dropboxPath,
          ...(target ? { sketchId: target } : { newTitle: projectName }),
        }),
      });
      const linkData = (await linkRes.json().catch(() => ({}))) as { ok?: boolean; sketch?: { id: string }; error?: string };
      if (!linkRes.ok || !linkData.ok || !linkData.sketch?.id) {
        setErr(linkData.error ?? "החיבור לעמוד של אבי נכשל"); setPhase("ask"); return;
      }

      // Reuse the existing manual-notify route as-is — it re-reads the sketch and
      // derives the "סקיצה N" text itself; we send no payload.
      const notifyRes = await fetch(`${API}/sketches/${linkData.sketch.id}/notify`, { method: "POST" });
      const notifyData = (await notifyRes.json().catch(() => ({}))) as { ok?: boolean; aviSent?: boolean; error?: string };
      const notice = !notifyRes.ok || !notifyData.ok
        ? (notifyData.error ?? "הקובץ חובר לעמוד של אבי, אך שליחת ההתראה נכשלה")
        : !notifyData.aviSent
          ? "הקובץ חובר לעמוד של אבי — אך לאבי אין מכשיר עם התראות פעילות"
          : null;
      setWarn(notice);
      setPhase("done");
      setTimeout(onClose, notice ? 4200 : 2200);
    } catch {
      setErr("שגיאת רשת, נסה שוב"); setPhase("ask");
    }
  };

  const options = info?.sketches ?? [];
  const matched = info?.match ?? null;
  const busy = phase === "working";

  const btn: React.CSSProperties = {
    padding: "12px 0", borderRadius: 11, fontSize: 13.5, fontWeight: 800,
    fontFamily: "inherit", cursor: "pointer", width: "100%", boxSizing: "border-box",
  };

  return createPortal(
    <div
      dir="rtl"
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 12000, background: "rgba(0,0,0,0.72)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
        fontFamily: "'Heebo', Arial, sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 420, background: CARD, border: `1px solid ${BDR}`,
          borderRadius: 18, padding: 22, boxShadow: "0 24px 60px rgba(0,0,0,0.6)", color: TEXT,
        }}
      >
        {phase === "loading" && <div style={{ color: TEXT2, textAlign: "center", padding: "18px 0", fontSize: 13.5 }}>בודק את הספרייה של אבי…</div>}

        {phase === "failed" && (
          <>
            <div style={{ fontSize: 13.5, color: "#FF8A8A", marginBottom: 16, lineHeight: 1.6 }}>{err}</div>
            <button onClick={onClose} style={{ ...btn, background: "transparent", border: `1px solid ${BDR}`, color: TEXT2 }}>סגור</button>
          </>
        )}

        {(phase === "ask" || busy) && info && (
          <>
            <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 8 }}>הקובץ עלה בהצלחה.</div>
            <div style={{ fontSize: 13.5, color: TEXT2, lineHeight: 1.7, marginBottom: 16 }}>
              {matched
                ? <>להמשיך ולעדכן את אבי בפרויקט <b style={{ color: TEXT }}>„{matched.title}”</b>?</>
                : info.ambiguous
                  ? <>נמצאו כמה סקיצות בשם <b style={{ color: TEXT }}>„{projectName}”</b> — בחר לאיזו לצרף את הקובץ.</>
                  : <>לא נמצאה אצל אבי סקיצה בשם <b style={{ color: TEXT }}>„{projectName}”</b> — בחר יעד.</>}
            </div>

            {!matched && (
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 16, maxHeight: 240, overflowY: "auto" }}>
                <label style={rowStyle(target === "")}>
                  <input type="radio" name="avi-target" checked={target === ""} onChange={() => setTarget("")} disabled={busy} />
                  <span>צור סקיצה חדשה בשם „{projectName}”</span>
                </label>
                {options.map((o) => (
                  <label key={o.id} style={rowStyle(target === o.id)}>
                    <input type="radio" name="avi-target" checked={target === o.id} onChange={() => setTarget(o.id)} disabled={busy} />
                    <span>{o.title}</span>
                  </label>
                ))}
              </div>
            )}

            {err && <div style={{ fontSize: 12.5, color: "#FF8A8A", marginBottom: 12, lineHeight: 1.6 }}>{err}</div>}

            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <button
                onClick={confirm}
                disabled={busy}
                style={{ ...btn, border: "none", color: "#fff", opacity: busy ? 0.6 : 1, cursor: busy ? "not-allowed" : "pointer", background: "linear-gradient(180deg, #E5322F, #C01C1C)" }}
              >
                {busy ? "מעדכן…" : "כן, עדכן את אבי"}
              </button>
              <button
                onClick={onClose}
                disabled={busy}
                style={{ ...btn, background: "transparent", border: `1px solid ${BDR}`, color: TEXT2, opacity: busy ? 0.5 : 1, cursor: busy ? "not-allowed" : "pointer" }}
              >
                לא עכשיו
              </button>
            </div>
          </>
        )}

        {phase === "done" && (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div style={{ fontSize: 15.5, fontWeight: 900, color: BRAND, marginBottom: 8 }}>✓ עודכן אצל אבי</div>
            <div style={{ fontSize: 13, color: warn ? "#F59E0B" : TEXT2, lineHeight: 1.6 }}>
              {warn ?? "ההתראה נשלחה לאבי"}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function rowStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 10,
    border: `1px solid ${active ? `${BRAND}66` : BDR}`,
    background: active ? "rgba(220,38,38,0.10)" : "rgba(255,255,255,0.02)",
    fontSize: 13, fontWeight: 700, cursor: "pointer",
  };
}
