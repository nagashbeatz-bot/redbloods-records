"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useProjects } from "@/components/ProjectsProvider";

const AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aiff", ".aif"];

// SVG ring geometry for sm button (26×26)
const SM_R    = 10;
const SM_CIRC = 2 * Math.PI * SM_R; // ≈62.8

interface Props {
  projectId: string;
  projectName: string;
  artist: string;
  existingFiles: { name: string }[];
  /** "sm" = 26px circle (table / player)  |  "md" = pill with label (detail page) */
  size?: "sm" | "md";
}

type State = "idle" | "uploading" | "done" | "error";

function buildVersionName(
  artist: string,
  projectName: string,
  existingFiles: { name: string }[],
  ext: string
): string {
  const audioCount = existingFiles.filter((f) =>
    AUDIO_EXTS.some((x) => f.name.toLowerCase().endsWith(x))
  ).length;
  const version = audioCount + 1;
  const date = new Date().toISOString().split("T")[0];
  const sanitize = (s: string) => s.replace(/[/\\:*?"<>|]/g, "").trim();
  return `${sanitize(artist)} - ${sanitize(projectName)} - ${date} - V${version}.${ext}`;
}

export default function UploadButton({
  projectId,
  projectName,
  artist,
  existingFiles,
  size = "sm",
}: Props) {
  const inputRef  = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [state,      setState]      = useState<State>("idle");
  const [progress,   setProgress]   = useState(0);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);
  const [dragging,   setDragging]   = useState(false);
  const [shareUrl,   setShareUrl]   = useState<string | null>(null);
  const [popupAnchor, setPopupAnchor] = useState<{ bottom: number; right: number } | null>(null);
  const [copied,     setCopied]     = useState(false);
  const { refresh } = useProjects();

  const reset = (delay = 4000) =>
    setTimeout(() => { setState("idle"); setErrorMsg(null); setProgress(0); }, delay);

  // ── Core upload logic (accepts a raw File) ──────────────────────────────────
  const processFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!AUDIO_EXTS.includes(`.${ext}`)) {
      setState("error");
      setErrorMsg("יש לבחור קובץ אודיו (MP3, WAV, M4A)");
      reset(3500);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    const newName = buildVersionName(artist, projectName, existingFiles, ext);
    setState("uploading");
    setProgress(0);

    const body = new FormData();
    body.append("file", file, newName);
    body.append("projectId", projectId);
    body.append("newName", newName);

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();

      // 0→85% = client→server, last 15% = server→Dropbox
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 85));
      };

      xhr.onload = async () => {
        setProgress(100);
        if (xhr.status >= 200 && xhr.status < 300) {
          let ok = false;
          let url = "";
          try {
            const json = JSON.parse(xhr.responseText);
            ok = !!json.ok;
            url = json.shareUrl ?? "";
            if (!ok) throw new Error(json.error || "שגיאה בהעלאה");
          } catch (err) {
            setState("error");
            setErrorMsg(err instanceof Error ? err.message : "שגיאה בהעלאה");
            reset();
            resolve();
            return;
          }
          setState("done");
          await refresh();
          // Show share popup for 5 seconds (portal — escapes overflow:hidden)
          if (url) {
            if (buttonRef.current) {
              const r = buttonRef.current.getBoundingClientRect();
              setPopupAnchor({
                bottom: window.innerHeight - r.top + 8,
                right:  window.innerWidth  - r.right,
              });
            }
            setShareUrl(url);
            setCopied(false);
            setTimeout(() => setShareUrl(null), 5000);
          }
          reset(2000);
        } else {
          let msg = "שגיאה בהעלאה";
          try { msg = JSON.parse(xhr.responseText).error ?? msg; } catch {}
          setState("error");
          setErrorMsg(msg);
          reset();
        }
        resolve();
      };

      xhr.onerror = () => {
        setState("error");
        setErrorMsg("שגיאת חיבור");
        reset();
        resolve();
      };

      xhr.open("POST", "/api/dropbox/upload");
      xhr.send(body);
    });

    if (inputRef.current) inputRef.current.value = "";
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  // ── Drag-and-drop handlers ──────────────────────────────────────────────────
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (state === "idle") setDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (state !== "idle") return;
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const tooltip =
    dragging          ? "שחרר להעלאה"
    : state === "uploading" ? `מעלה... ${progress > 0 ? `${progress}%` : ""}`.trim()
    : state === "done"      ? "הועלה בהצלחה ✓"
    : state === "error"     ? (errorMsg ?? "שגיאה")
    : `העלה גרסה ל-${projectName}`;

  // ── SM (circle 26px) ────────────────────────────────────────────────────────
  if (size === "sm") {
    const iconColor =
      dragging             ? "#10B981"
      : state === "done"   ? "#10B981"
      : state === "error"  ? "#EF4444"
      : state === "uploading" ? "#10B981"
      : "#555";

    const ringColor  = state === "error" ? "#EF4444" : "#10B981";
    const showRing   = state === "uploading" || state === "done";
    const dashOffset = SM_CIRC * (1 - progress / 100);

    return (
      <div style={{ position: "relative", flexShrink: 0 }}>
        <style>{`@keyframes rb-spin{to{transform:rotate(360deg)}}`}</style>

        <input
          ref={inputRef}
          type="file"
          accept=".mp3,.wav,.m4a,.ogg,.flac,.aiff,.aif"
          style={{ display: "none" }}
          onChange={handleInputChange}
        />

        <button
          ref={buttonRef}
          onClick={(e) => { e.stopPropagation(); if (state === "idle") inputRef.current?.click(); }}
          disabled={state === "uploading"}
          title={tooltip}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          style={{
            position: "relative",
            width: 26, height: 26, borderRadius: "50%",
            border: dragging ? "1.5px solid #10B981" : "none",
            cursor: state === "uploading" ? "wait" : state === "idle" ? "pointer" : "default",
            background: dragging
              ? "rgba(16,185,129,0.18)"
              : showRing ? "transparent" : "rgba(255,255,255,0.04)",
            color: iconColor,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, flexShrink: 0, transition: "color 0.15s, background 0.15s, border 0.15s",
          }}
          onMouseEnter={(e) => {
            if (state !== "idle" || dragging) return;
            e.currentTarget.style.background = "rgba(16,185,129,0.12)";
            e.currentTarget.style.color = "#10B981";
          }}
          onMouseLeave={(e) => {
            if (state !== "idle" || dragging) return;
            e.currentTarget.style.background = "rgba(255,255,255,0.04)";
            e.currentTarget.style.color = "#555";
          }}
        >
          {/* Progress / done ring */}
          {showRing && (
            <svg
              width="26" height="26"
              style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)", pointerEvents: "none" }}
            >
              <circle cx="13" cy="13" r={SM_R} fill="none" stroke="rgba(16,185,129,0.15)" strokeWidth="2" />
              <circle
                cx="13" cy="13" r={SM_R}
                fill="none" stroke={ringColor} strokeWidth="2"
                strokeDasharray={SM_CIRC} strokeDashoffset={dashOffset}
                strokeLinecap="round"
                style={{ transition: "stroke-dashoffset 0.35s ease" }}
              />
            </svg>
          )}

          {/* Indeterminate spinner */}
          {state === "uploading" && progress === 0 && (
            <svg
              width="26" height="26"
              style={{
                position: "absolute", inset: 0, pointerEvents: "none",
                transformOrigin: "13px 13px",
                animation: "rb-spin 0.9s linear infinite",
              }}
            >
              <circle
                cx="13" cy="13" r={SM_R}
                fill="none" stroke="#10B981" strokeWidth="2"
                strokeDasharray={`${SM_CIRC * 0.28} ${SM_CIRC * 0.72}`}
                strokeLinecap="round"
              />
            </svg>
          )}

          <span style={{ position: "relative", zIndex: 1, lineHeight: 1 }}>
            {state === "done" ? "✓" : state === "error" ? "✕" : dragging ? "↓" : "↑"}
          </span>
        </button>

        {/* Error tooltip */}
        {state === "error" && errorMsg && (
          <div style={{
            position: "absolute", bottom: "calc(100% + 6px)", right: 0,
            background: "#2A1010", border: "1px solid #5A1A1A", color: "#FF6B6B",
            fontSize: 11, padding: "4px 10px", borderRadius: 6,
            whiteSpace: "nowrap", zIndex: 200, pointerEvents: "none",
          }}>
            {errorMsg}
          </div>
        )}

        {/* Share link popup — portal to escape overflow:hidden */}
        {shareUrl && popupAnchor && typeof document !== "undefined" && createPortal(
          <SharePopup url={shareUrl} anchor={popupAnchor} copied={copied}
            onCopy={() => { navigator.clipboard.writeText(shareUrl).then(() => setCopied(true)); }}
            onClose={() => setShareUrl(null)} />,
          document.body
        )}
      </div>
    );
  }

  // ── MD (pill with label) ────────────────────────────────────────────────────
  const mdBorder =
    dragging             ? "rgba(16,185,129,0.5)"
    : state === "done"   ? "rgba(16,185,129,0.35)"
    : state === "error"  ? "rgba(239,68,68,0.35)"
    : "#2A2A2A";
  const mdBg =
    dragging             ? "rgba(16,185,129,0.12)"
    : state === "done"   ? "rgba(16,185,129,0.08)"
    : state === "error"  ? "rgba(239,68,68,0.08)"
    : "#1A1A1A";
  const mdColor =
    dragging                ? "#10B981"
    : state === "done"      ? "#10B981"
    : state === "error"     ? "#EF4444"
    : state === "uploading" ? "#10B981"
    : "#888";

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <style>{`@keyframes rb-spin{to{transform:rotate(360deg)}}`}</style>

      <input
        ref={inputRef}
        type="file"
        accept=".mp3,.wav,.m4a,.ogg,.flac,.aiff,.aif"
        style={{ display: "none" }}
        onChange={handleInputChange}
      />

      {/* Share link popup — portal to escape overflow:hidden */}
      {shareUrl && popupAnchor && typeof document !== "undefined" && createPortal(
        <SharePopup url={shareUrl} anchor={popupAnchor} copied={copied}
          onCopy={() => { navigator.clipboard.writeText(shareUrl).then(() => setCopied(true)); }}
          onClose={() => setShareUrl(null)} />,
        document.body
      )}

      <button
        ref={buttonRef}
        onClick={(e) => { e.stopPropagation(); if (state === "idle") inputRef.current?.click(); }}
        disabled={state === "uploading"}
        title={tooltip}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 12px", borderRadius: 10,
          border: `1px solid ${mdBorder}`,
          cursor: state === "uploading" ? "wait" : state === "idle" ? "pointer" : "default",
          background: mdBg, color: mdColor,
          fontSize: 13, fontWeight: 500, transition: "all 0.15s",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => {
          if (state !== "idle" || dragging) return;
          e.currentTarget.style.borderColor = "rgba(16,185,129,0.35)";
          e.currentTarget.style.background   = "rgba(16,185,129,0.08)";
          e.currentTarget.style.color        = "#10B981";
        }}
        onMouseLeave={(e) => {
          if (state !== "idle" || dragging) return;
          e.currentTarget.style.borderColor = "#2A2A2A";
          e.currentTarget.style.background   = "#1A1A1A";
          e.currentTarget.style.color        = "#888";
        }}
      >
        {state === "uploading" ? (
          <>
            <svg width="13" height="13"
              style={{ flexShrink: 0, transformOrigin: "6.5px 6.5px", animation: "rb-spin 0.9s linear infinite" }}
            >
              <circle cx="6.5" cy="6.5" r="5"
                fill="none" stroke="#10B981" strokeWidth="1.5"
                strokeDasharray={`${2 * Math.PI * 5 * 0.28} ${2 * Math.PI * 5 * 0.72}`}
                strokeLinecap="round"
              />
            </svg>
            <span>מעלה{progress > 0 ? ` ${progress}%` : "..."}</span>
          </>
        ) : state === "done" ? (
          <><span>✓</span><span>הועלה</span></>
        ) : state === "error" ? (
          <><span>✕</span><span>{errorMsg ? errorMsg.slice(0, 20) : "שגיאה"}</span></>
        ) : dragging ? (
          <><span style={{ fontSize: 15, lineHeight: 1 }}>↓</span><span>שחרר להעלאה</span></>
        ) : (
          <><span style={{ fontSize: 15, lineHeight: 1 }}>↑</span><span>העלה גרסה</span></>
        )}
      </button>
    </div>
  );
}

// ── Share link popup ──────────────────────────────────────────────────────────
function SharePopup({
  url, anchor, copied, onCopy, onClose,
}: { url: string; anchor: { bottom: number; right: number }; copied: boolean; onCopy: () => void; onClose: () => void }) {
  return (
    <div style={{
      position: "fixed",
      bottom: anchor.bottom,
      right:  anchor.right,
      zIndex: 99999,
      background: "#1C1C1C",
      border: "1px solid #333",
      borderRadius: 10,
      padding: "10px 12px",
      width: 260,
      boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#10B981" }}>✓ הועלה — קישור לשיתוף</span>
        <button onClick={onClose} style={{
          background: "none", border: "none", cursor: "pointer",
          color: "#555", fontSize: 16, padding: 0, lineHeight: 1,
        }}>×</button>
      </div>
      <div style={{
        background: "#111", borderRadius: 6, padding: "5px 8px",
        fontSize: 10, color: "#666", wordBreak: "break-all",
        marginBottom: 8, lineHeight: 1.4,
      }}>
        {url.length > 60 ? url.slice(0, 57) + "..." : url}
      </div>
      <button
        onClick={onCopy}
        style={{
          width: "100%", padding: "6px 0", borderRadius: 7,
          border: "none", cursor: "pointer", fontFamily: "inherit",
          fontSize: 12, fontWeight: 600,
          background: copied ? "rgba(16,185,129,0.15)" : "#3B82F6",
          color: copied ? "#10B981" : "#fff",
          transition: "all 0.2s",
        }}
      >
        {copied ? "✓ הועתק!" : "העתק קישור"}
      </button>
    </div>
  );
}
