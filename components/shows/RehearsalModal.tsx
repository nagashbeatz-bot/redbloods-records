"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Show } from "@/lib/shows-types";
import DatePickerInput from "@/components/ui/DatePickerInput";
import TimePickerInput from "@/components/ui/TimePickerInput";

// ── Design tokens (local to the modal) ──────────────────────────────────────
const INDIGO = "#6366F1";
const field: React.CSSProperties = {
  width: "100%", padding: "11px 13px", borderRadius: 11,
  border: "1px solid rgba(255,255,255,0.09)", background: "#0F0F14", color: "#ECECF1",
  fontSize: 13.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const lbl: React.CSSProperties = {
  fontSize: 11, color: "#7A7A85", marginBottom: 7, fontWeight: 700, letterSpacing: "0.03em",
};

/** A rehearsal session as returned by GET /api/sessions?showId (enriched). */
export interface RehearsalSession {
  id: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string;
  status: string;
  cost: number | null;
  notes: string;
  calendar_event_id: string | null;
  payment_status: string | null; // from the linked transaction (null if none)
}

const OP_STATUSES = ["מתוכנן", "בוצע", "בוטל"] as const;

// Rehearsal duration presets (minutes) + "אחר" for a custom value.
const DUR_OPTS = [
  { label: "שעה", min: 60 },
  { label: "שעה וחצי", min: 90 },
  { label: "שעתיים", min: 120 },
  { label: "שעתיים וחצי", min: 150 },
  { label: "3 שעות", min: 180 },
];
const OTHER = "אחר";

/** YYYY-MM-DD + 1 day (UTC-safe, no libs) — for a calendar end that crosses midnight. */
function addDayStr(d: string): string {
  const [y, m, dd] = d.split("-").map(Number);
  const nd = new Date(Date.UTC(y, m - 1, dd) + 86400000);
  return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, "0")}-${String(nd.getUTCDate()).padStart(2, "0")}`;
}

/** HH:MM + minutes → HH:MM (wraps past midnight). */
function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const t = (h * 60 + m + mins) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** Derive duration (minutes) from an existing start/end (handles crossing midnight). */
function durationFromTimes(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return null;
  let d = (eh * 60 + em) - (sh * 60 + sm);
  if (d < 0) d += 24 * 60;
  return d > 0 ? d : null;
}

/** Modern custom dropdown for the rehearsal duration (presets + "אחר"). */
function DurationPicker({ label, onPick, style, className }: {
  label: string;
  onPick: (opt: { label: string; min: number | null }) => void;
  style?: React.CSSProperties;
  className?: string;
}) {
  const btnRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const opts: { label: string; min: number | null }[] = [...DUR_OPTS, { label: OTHER, min: null }];

  function openPanel() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    setOpen(true);
  }
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (document.getElementById("rb-dur-portal")?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  const dropdown = (
    <div id="rb-dur-portal" style={{
      position: "fixed", top: pos.top, left: pos.left, width: Math.max(pos.width, 150),
      zIndex: 200010, background: "#15151B", border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 12, padding: 6, boxShadow: "0 18px 50px rgba(0,0,0,0.75)", direction: "rtl",
    }}>
      {opts.map(o => {
        const active = o.label === label;
        return (
          <button key={o.label} type="button" onClick={() => { onPick(o); setOpen(false); }}
            style={{
              display: "block", width: "100%", textAlign: "right", padding: "9px 11px",
              borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13,
              background: active ? "rgba(99,102,241,0.22)" : "transparent",
              color: active ? "#A5B4FC" : "#D8D8DE", fontWeight: active ? 700 : 500,
            }}
            onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)"; }}
            onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
          >{o.label}</button>
        );
      })}
    </div>
  );

  return (
    <>
      <div ref={btnRef} role="button" tabIndex={0} onClick={openPanel}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPanel(); } }}
        className={className} aria-haspopup="listbox" aria-expanded={open}
        style={{
          position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 6, cursor: "pointer", userSelect: "none", ...style,
          ...(open ? { borderColor: "rgba(99,102,241,0.55)", boxShadow: "0 0 0 3px rgba(99,102,241,0.14)" } : {}),
        }}>
        <span style={{ color: "#ECECF1" }}>{label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, opacity: 0.5, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {open && typeof document !== "undefined" && createPortal(dropdown, document.body)}
    </>
  );
}

/**
 * Schedule OR edit a rehearsal for a show. Rehearsals are sessions
 * (session_type="חזרה להופעה") linked to the show via sessions.show_id, carrying
 * an optional cost. When cost > 0 the server creates/updates ONE canonical
 * expense transaction (idempotent via linked_session_id) and re-derives the
 * show's Fin-2 split. Google Calendar behaviour is unchanged. UI only — no
 * business/finance logic here.
 */
export default function RehearsalModal({ show, onClose, onCreated, rehearsal }: {
  show: Show;
  onClose: () => void;
  onCreated?: () => void;
  rehearsal?: RehearsalSession | null;
}) {
  const isEdit = !!rehearsal;
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());

  const [date,      setDate]      = useState<string>(rehearsal?.date || show.date || todayStr);
  const [startTime, setStartTime] = useState<string>(rehearsal?.start_time || show.start_time || "");
  // Duration replaces "end time": end_time = start + duration (computed on save).
  const initDur     = durationFromTimes(rehearsal?.start_time, rehearsal?.end_time);
  const initMatched = initDur != null ? DUR_OPTS.find(o => o.min === initDur) : undefined;
  const [durLabel,  setDurLabel]  = useState<string>(initDur == null ? "שעתיים" : (initMatched ? initMatched.label : OTHER));
  const [customMin, setCustomMin] = useState<string>(initDur != null && !initMatched ? String(initDur) : "");
  const [location,  setLocation]  = useState<string>(rehearsal?.location ?? "גרוב הוד השרון");
  const [userNotes, setUserNotes] = useState<string>(isEdit ? (rehearsal?.notes ?? "") : "");
  const [cost,      setCost]      = useState<string>(rehearsal?.cost != null ? String(rehearsal.cost) : "");
  const [opStatus,  setOpStatus]  = useState<string>(rehearsal?.status || "מתוכנן");
  const initialPay = rehearsal?.payment_status === "שולם" ? "שולם"
    : rehearsal?.payment_status === "לא שולם" ? "לא שולם"
    : isEdit ? null : "לא שולם";
  const [pay,       setPay]       = useState<"שולם" | "לא שולם" | null>(initialPay);
  const [addToCal,  setAddToCal]  = useState<boolean>(false);
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState<string | null>(null);

  const isPartial = rehearsal?.payment_status === "חלקי";
  const costNum = cost.trim() === "" ? 0 : Number(cost);
  const costInvalid = cost.trim() !== "" && (!Number.isFinite(costNum) || costNum < 0);

  const durTotal = durLabel === OTHER
    ? (customMin.trim() === "" ? NaN : Number(customMin))
    : (DUR_OPTS.find(o => o.label === durLabel)?.min ?? 120);
  const durInvalid = !Number.isFinite(durTotal) || durTotal <= 0;
  const endPreview = (startTime && !durInvalid) ? addMinutes(startTime, durTotal) : "";
  const crossesMidnightPreview = (startTime && !durInvalid)
    ? (Number(startTime.split(":")[0]) * 60 + Number(startTime.split(":")[1]) + durTotal) >= 24 * 60
    : false;
  const pickDuration = (o: { label: string; min: number | null }) => {
    setDurLabel(o.label);
    if (o.label !== OTHER) setCustomMin("");
  };

  async function handleSave() {
    if (!date || !startTime) { setErr("צריך תאריך ושעת התחלה"); return; }
    if (costInvalid) { setErr("עלות לא תקינה"); return; }
    if (durInvalid)  { setErr("משך לא תקין"); return; }
    setSaving(true); setErr(null);
    // Compute end_time = start + duration (wraps past midnight; both stored).
    const [sH, sM] = startTime.split(":").map(Number);
    const endTime = addMinutes(startTime, durTotal);
    const crossesMidnight = (sH * 60 + sM + durTotal) >= 24 * 60;
    const ref   = `חזרה עבור הופעה: ${show.name}${show.artist ? ` | אמן: ${show.artist}` : ""}`;
    const notes = isEdit
      ? (userNotes.trim() || ref)
      : (userNotes.trim() ? `${ref}\n${userNotes.trim()}` : ref);
    try {
      let res: Response;
      if (isEdit && rehearsal) {
        const startIso = `${date}T${startTime}:00`;
        const endIso   = `${crossesMidnight ? addDayStr(date) : date}T${endTime}:00`;
        res = await fetch(`/api/sessions/${rehearsal.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date, startTime, endTime,
            status: opStatus, location: location.trim() || "גרוב הוד השרון", notes,
            cost: cost.trim() === "" ? null : costNum,
            ...(pay ? { paymentStatus: pay } : {}),
            startIso, endIso, summary: `חזרה להופעה - ${show.name}`,
          }),
        });
      } else {
        res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title:         show.name,
            date, startTime, endTime,
            status:        opStatus,
            sessionType:   "חזרה להופעה",
            location:      location.trim() || "גרוב הוד השרון",
            notes,
            showId:        show.id,
            cost:          cost.trim() === "" ? null : costNum,
            paymentStatus: pay ?? "לא שולם",
            addToCalendar: addToCal,
          }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "שגיאה בשמירת החזרה");
      onCreated?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה");
      setSaving(false);
    }
  }

  // Segmented pill button (payment / status)
  const seg = (activeVal: string, cur: string | null, color: string): React.CSSProperties => ({
    flex: 1, padding: "10px 8px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
    fontSize: 12.5, fontWeight: 700, transition: "all .15s ease",
    background: cur === activeVal ? `${color}22` : "rgba(255,255,255,0.02)",
    color: cur === activeVal ? color : "#8A8A93",
    border: `1px solid ${cur === activeVal ? `${color}66` : "rgba(255,255,255,0.07)"}`,
  });

  const modal = (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(5px)", zIndex: 200000 }} />
      <div className="rb-reh" style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        background: "linear-gradient(180deg, #17171D 0%, #131317 100%)",
        border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20,
        width: 412, maxWidth: "94vw", maxHeight: "92vh", overflowY: "auto",
        zIndex: 200001, padding: "22px 22px 20px", direction: "rtl",
        fontFamily: "'Heebo', Arial, sans-serif",
        boxShadow: "0 30px 90px rgba(0,0,0,0.75)",
      }}>
        <style>{`
          .rb-reh .rb-field, .rb-reh .rb-trigger { transition: border-color .15s ease, box-shadow .15s ease, background .15s ease; }
          .rb-reh .rb-field:hover, .rb-reh .rb-trigger:hover { border-color: rgba(255,255,255,0.16); }
          .rb-reh .rb-field:focus, .rb-reh .rb-field:focus-visible,
          .rb-reh .rb-trigger:focus, .rb-reh .rb-trigger:focus-visible {
            border-color: rgba(99,102,241,0.55) !important;
            box-shadow: 0 0 0 3px rgba(99,102,241,0.14); outline: none;
          }
          .rb-reh input::placeholder, .rb-reh textarea::placeholder { color: #55555E; }
          /* Hide the browser's native number spinner — keep numeric input + mobile numpad */
          .rb-reh input[type=number]::-webkit-inner-spin-button,
          .rb-reh input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; appearance: none; margin: 0; }
          .rb-reh input[type=number] { -moz-appearance: textfield; appearance: textfield; }
          .rb-reh::-webkit-scrollbar { width: 9px; }
          .rb-reh::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.09); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
        `}</style>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 13, flexShrink: 0,
            background: `linear-gradient(150deg, ${INDIGO}33, ${INDIGO}14)`,
            border: `1px solid ${INDIGO}4D`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
          }}>🥁</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#8B93F8", letterSpacing: "0.1em", textTransform: "uppercase" }}>{isEdit ? "עריכת חזרה" : "קביעת חזרה"}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#F4F4F7", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{show.name}</div>
            {show.artist && <div style={{ fontSize: 11.5, color: "#7A7A85", marginTop: 1 }}>{show.artist}</div>}
          </div>
          <button onClick={onClose} aria-label="סגור" style={{
            width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)", color: "#9A9AA3", cursor: "pointer",
            fontSize: 16, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
        </div>

        {err && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 11, padding: "9px 13px", color: "#FCA5A5", fontSize: 12.5, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <span>⚠</span>{err}
          </div>
        )}

        {/* ── Date ── */}
        <div style={{ marginBottom: 15 }}>
          <div style={lbl}>תאריך חזרה</div>
          <DatePickerInput value={date} onChange={setDate} placeholder="בחר תאריך" className="rb-trigger" style={field} />
        </div>

        {/* ── Start time + duration ── */}
        <div style={{ display: "flex", gap: 12, marginBottom: durLabel === OTHER ? 10 : (endPreview ? 7 : 15), flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 130px" }}>
            <div style={lbl}>שעת התחלה</div>
            <TimePickerInput value={startTime} onChange={setStartTime} className="rb-trigger" style={field} />
          </div>
          <div style={{ flex: "1 1 130px" }}>
            <div style={lbl}>משך החזרה</div>
            <DurationPicker label={durLabel} onPick={pickDuration} className="rb-trigger" style={field} />
          </div>
        </div>
        {durLabel === OTHER && (
          <div style={{ marginBottom: endPreview ? 7 : 15 }}>
            <div style={lbl}>משך מותאם (בדקות)</div>
            <input className="rb-field" type="number" min={1} value={customMin} onChange={e => setCustomMin(e.target.value)} placeholder="למשל 200"
              style={{ ...field, ...(customMin.trim() !== "" && durInvalid ? { borderColor: "rgba(239,68,68,0.55)" } : {}) }} />
          </div>
        )}
        {endPreview && (
          <div style={{ fontSize: 11, color: "#7A7A85", marginBottom: 15, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ opacity: 0.7 }}>🕒</span>
            סיום משוער:&nbsp;<strong style={{ color: "#C9C9D2", fontVariantNumeric: "tabular-nums", direction: "ltr", unicodeBidi: "plaintext" } as React.CSSProperties}>{endPreview}</strong>
            {crossesMidnightPreview && <span style={{ color: "#8B93F8" }}>(למחרת)</span>}
          </div>
        )}

        {/* ── Location ── */}
        <div style={{ marginBottom: 15 }}>
          <div style={lbl}>מיקום / חדר חזרות</div>
          <input className="rb-field" value={location} onChange={e => setLocation(e.target.value)} placeholder="גרוב הוד השרון" style={field} />
        </div>

        {/* ── Cost ── */}
        <div style={{ marginBottom: 15 }}>
          <div style={lbl}>עלות</div>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", insetInlineStart: 13, top: "50%", transform: "translateY(-50%)", color: "#6A6A72", fontSize: 13.5, pointerEvents: "none" }}>₪</span>
            <input className="rb-field" type="number" min={0} value={cost} onChange={e => setCost(e.target.value)} placeholder="0"
              style={{ ...field, paddingInlineStart: 30, ...(costInvalid ? { borderColor: "rgba(239,68,68,0.55)" } : {}) }} />
          </div>
          <div style={{ fontSize: 10.5, color: "#55555E", marginTop: 6 }}>ריק או 0 = לא נוצרת הוצאה כספית</div>
        </div>

        {/* ── Payment status (only when there's a cost) ── */}
        {costNum > 0 && (
          <div style={{ marginBottom: 15 }}>
            <div style={lbl}>סטטוס תשלום</div>
            {isPartial && (
              <div style={{ background: "rgba(245,166,35,0.1)", border: "1px solid rgba(245,166,35,0.32)", borderRadius: 10, padding: "8px 11px", color: "#F5A623", fontSize: 11.5, marginBottom: 9, lineHeight: 1.5 }}>
                ⚠ ההוצאה במצב "חלקי" — לא נתמך בחזרות ואינו מקוזז. בחר סטטוס כדי לפתור.
              </div>
            )}
            <div style={{ display: "flex", gap: 9 }}>
              <button type="button" onClick={() => setPay("לא שולם")} style={seg("לא שולם", pay, "#EF4444")}>לא שולם</button>
              <button type="button" onClick={() => setPay("שולם")} style={seg("שולם", pay, "#13C99A")}>שולם</button>
            </div>
          </div>
        )}

        {/* ── Operational status (edit only) ── */}
        {isEdit && (
          <div style={{ marginBottom: 15 }}>
            <div style={lbl}>סטטוס חזרה</div>
            <div style={{ display: "flex", gap: 9 }}>
              {OP_STATUSES.map(s => (
                <button key={s} type="button" onClick={() => setOpStatus(s)} style={seg(s, opStatus, INDIGO)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {/* ── Notes ── */}
        <div style={{ marginBottom: isEdit ? 6 : 16 }}>
          <div style={lbl}>הערות</div>
          <textarea className="rb-field" value={userNotes} onChange={e => setUserNotes(e.target.value)} rows={2}
            placeholder="פרטים נוספים (לא חובה)…"
            style={{ ...field, resize: "vertical", lineHeight: 1.55 }} />
        </div>

        {/* ── Calendar toggle (create only) ── */}
        {!isEdit && (
          <button
            type="button"
            onClick={() => setAddToCal(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 11, width: "100%", cursor: "pointer",
              marginBottom: 18, padding: "12px 14px", borderRadius: 12, fontFamily: "inherit",
              border: `1px solid ${addToCal ? `${INDIGO}59` : "rgba(255,255,255,0.08)"}`,
              background: addToCal ? `${INDIGO}14` : "rgba(255,255,255,0.02)", transition: "all .15s ease",
            }}
          >
            <span style={{ fontSize: 15 }}>📅</span>
            <span style={{ flex: 1, textAlign: "right", fontSize: 13, fontWeight: 600, color: addToCal ? "#A5B4FC" : "#9A9AA3" }}>הוסף ליומן Google</span>
            {/* Toggle switch */}
            <span style={{
              width: 38, height: 22, borderRadius: 100, flexShrink: 0, position: "relative",
              background: addToCal ? INDIGO : "rgba(255,255,255,0.14)", transition: "background .18s ease",
            }}>
              <span style={{
                position: "absolute", top: 3, insetInlineStart: addToCal ? 19 : 3,
                width: 16, height: 16, borderRadius: "50%", background: "#fff",
                transition: "inset-inline-start .18s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
              }} />
            </span>
          </button>
        )}

        {/* ── Actions ── */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} disabled={saving} style={{
            flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.03)", color: "#B4B4BC", cursor: saving ? "default" : "pointer",
            fontFamily: "inherit", fontSize: 13.5, fontWeight: 600,
          }}>ביטול</button>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 2, padding: "12px", borderRadius: 12, border: "none",
            background: saving ? "#3A3A55" : `linear-gradient(180deg, #7375F5, ${INDIGO})`,
            color: "#fff", cursor: saving ? "default" : "pointer",
            fontWeight: 800, fontFamily: "inherit", fontSize: 14,
            boxShadow: saving ? "none" : `0 6px 20px ${INDIGO}55`,
          }}>{saving ? "שומר…" : isEdit ? "שמור שינויים" : "קבע חזרה"}</button>
        </div>
      </div>
    </>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
