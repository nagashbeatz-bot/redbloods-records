"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { ActionDef, FreeSlot } from "@/lib/action-types";
import { buildEventTitle } from "@/lib/action-types";
import {
  validStartTimes, fmtHM, fmtDayDate, confirmLabel,
  WORK_START_H, WORK_END_H, isWorkingDay,
} from "@/lib/schedule-rules";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "recommended" | "manual";

type Phase =
  | "idle"
  | "searching"
  | { slots: FreeSlot[] }
  | "no_slots"
  | "checking"
  | { confirm: { start: string; end: string; label: string; hardConflict: boolean; bufferWarning: boolean; conflictNames: string[]; forceCreate: boolean } }
  | "creating"
  | { created: { label: string; htmlLink?: string; inviteSent?: boolean } }
  | { error: string; needsReauth?: boolean };

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  action:      ActionDef;
  projectName: string;
  artist:      string;
  onClose:     () => void;
}

export default function ScheduleModal({ action, projectName, artist, onClose }: Props) {
  const [minutes,       setMinutes]       = useState(action.defaultMinutes);
  const [tab,           setTab]           = useState<Tab>("recommended");
  const [phase,         setPhase]         = useState<Phase>("idle");
  const [sendToArtist,   setSendToArtist]   = useState(false);
  const [artistEmail,    setArtistEmail]    = useState("");
  const [emailFromClients,setEmailFromClients] = useState(false);
  const [publicTitle,    setPublicTitle]    = useState(`${action.calPrefix} עם נגש ביטס`);

  // Auto-fill artist email from clients list
  useEffect(() => {
    if (!artist) return;
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => {
        if (!d.clients) return;
        const match = (d.clients as { name: string; email: string }[]).find(
          (c) => c.name.trim().toLowerCase() === artist.trim().toLowerCase()
        );
        if (match?.email) {
          setArtistEmail(match.email);
          setEmailFromClients(true);
        }
      })
      .catch(() => {});
  }, [artist]);

  // Manual picker state
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const [manualDate, setManualDate] = useState(todayStr);
  const [manualHM,   setManualHM]   = useState<{ h: number; m: number } | null>(null);

  // Reset slot selection when duration changes
  useEffect(() => {
    if (typeof phase === "object" && "slots" in phase) setPhase("idle");
    setManualHM(null);
  }, [minutes]);

  const title = buildEventTitle(action, artist, projectName);

  // ── Derived manual values ─────────────────────────────────────────────────
  const manualDateObj = useMemo(() => new Date(manualDate + "T00:00:00"), [manualDate]);
  const manualDayOk   = isWorkingDay(manualDateObj);

  const timeOptions = useMemo(() => validStartTimes(minutes), [minutes]);

  const manualEndHM = useMemo(() => {
    if (!manualHM) return null;
    const totalEnd = manualHM.h * 60 + manualHM.m + minutes;
    return { h: Math.floor(totalEnd / 60), m: totalEnd % 60 };
  }, [manualHM, minutes]);

  const manualHoursOk = manualEndHM
    ? manualEndHM.h * 60 + manualEndHM.m <= WORK_END_H * 60
    : true;

  const manualStart = manualHM && manualDate
    ? (() => {
        const d = new Date(manualDate + "T00:00:00");
        d.setHours(manualHM.h, manualHM.m, 0, 0);
        return d;
      })()
    : null;
  const manualEnd = manualStart && manualEndHM
    ? new Date(manualStart.getTime() + minutes * 60_000)
    : null;

  const manualReady = manualDayOk && manualHoursOk && !!manualStart;

  // ── Recommended: find slots ───────────────────────────────────────────────
  async function findSlots() {
    setPhase("searching");
    try {
      const r = await fetch(
        `/api/calendar/free-slots?duration=${minutes}&requiresBuffer=${action.requiresBuffer}&days=14`
      );
      const d = await r.json();
      if (d.needsReauth) { setPhase({ error: "יש לחבר מחדש את Google Calendar עם הרשאות כתיבה.", needsReauth: true }); return; }
      if (d.error)       { setPhase({ error: d.error }); return; }
      if (!d.slots?.length) { setPhase("no_slots"); return; }
      setPhase({ slots: d.slots });
    } catch { setPhase({ error: "שגיאת רשת" }); }
  }

  // ── Check a slot (recommended or manual) and show confirm ────────────────
  async function checkAndConfirm(startIso: string, endIso: string, label: string) {
    setPhase("checking");
    try {
      const r = await fetch("/api/calendar/check-slot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: startIso, end: endIso, requiresBuffer: action.requiresBuffer }),
      });
      const d = await r.json();
      if (d.error) { setPhase({ error: d.error }); return; }
      setPhase({
        confirm: {
          start: startIso, end: endIso, label,
          hardConflict:  d.hardConflict  ?? false,
          bufferWarning: d.bufferWarning ?? false,
          conflictNames: d.conflictNames ?? [],
          forceCreate:   false,
        },
      });
    } catch { setPhase({ error: "שגיאת רשת" }); }
  }

  // ── Create event ──────────────────────────────────────────────────────────
  async function createEvent(startIso: string, endIso: string, label: string) {
    setPhase("creating");
    try {
      // When sending to artist: use public title so they see "סשן עם נגש ביטס".
      // Without invite: use internal title so the user sees artist+project name.
      const summary = sendToArtist && artistEmail.trim() ? publicTitle : title;
      const body: Record<string, unknown> = { summary, start: startIso, end: endIso };
      if (sendToArtist && artistEmail.trim()) {
        body.artistEmail       = artistEmail.trim();
        body.publicDescription = `שם אמן: ${artist}\nשם פרויקט: ${projectName}`;
      }
      const r = await fetch("/api/calendar/create-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.needsReauth) { setPhase({ error: "יש לחבר מחדש את Google Calendar עם הרשאות כתיבה.", needsReauth: true }); return; }
      if (!d.ok)         { setPhase({ error: d.error ?? "שגיאה" }); return; }
      setPhase({ created: { label, htmlLink: d.event?.htmlLink, inviteSent: !!artistEmail && sendToArtist } });
    } catch { setPhase({ error: "שגיאת רשת" }); }
  }

  // ── Type guards ───────────────────────────────────────────────────────────
  const isSlots   = typeof phase === "object" && "slots"   in phase;
  const isConfirm = typeof phase === "object" && "confirm" in phase;
  const isCreated = typeof phase === "object" && "created" in phase;
  const isError   = typeof phase === "object" && "error"   in phase;
  const isBusy    = phase === "searching" || phase === "checking" || phase === "creating";

  const confirmData = isConfirm ? (phase as Extract<Phase, { confirm: unknown }>).confirm : null;
  const createdData = isCreated ? (phase as Extract<Phase, { created: unknown }>).created : null;
  const errorData   = isError   ? (phase as Extract<Phase, { error: string }>)             : null;

  // ─────────────────────────────────────────────────────────────────────────

  const modal = (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100000,
        background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, backdropFilter: "blur(6px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#141414", border: "1px solid #262626", borderRadius: 22,
          padding: "28px 28px 24px", width: "100%", maxWidth: 420,
          direction: "rtl", fontFamily: "inherit",
          boxShadow: "0 24px 64px rgba(0,0,0,0.9)",
        }}
        onClick={(e) => e.stopPropagation()}
      >

        {/* ── Header ───────────────────────────────────────────────── */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#A855F7", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>
            ⚡ {action.modalTitle}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#F5F5F5", lineHeight: 1.2 }}>{projectName}</div>
          <div style={{ fontSize: 14, color: "#999", marginTop: 4 }}>{artist}</div>
        </div>

        {/* ── Duration pills ────────────────────────────────────────── */}
        {!isCreated && (
          <div style={{ marginBottom: 20 }}>
            <Label>משך זמן</Label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {action.durations.map((d) => (
                <Pill
                  key={d.minutes}
                  active={d.minutes === minutes}
                  onClick={() => setMinutes(d.minutes)}
                >
                  {d.label}
                </Pill>
              ))}
            </div>
          </div>
        )}

        {/* ── Event title preview ───────────────────────────────────── */}
        {!isCreated && !isConfirm && (
          <div style={{ marginBottom: 22 }}>
            <Label>שם האירוע ביומן</Label>
            <div style={{
              background: "#111", border: "1px solid #303030", borderRadius: 11,
              padding: "10px 14px", display: "flex", alignItems: "center",
              gap: 6, direction: "rtl", overflow: "hidden",
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#C084FC", flexShrink: 0 }}>{action.calPrefix}</span>
              <Sep />
              <span style={{ fontSize: 13, color: "#C0C0C0", fontWeight: 500, flexShrink: 0 }}>{artist}</span>
              <Sep />
              <span style={{ fontSize: 13, color: "#E8E8E8", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {projectName}
              </span>
            </div>
          </div>
        )}

        {/* ── RECOMMENDED / MANUAL tabs ─────────────────────────────── */}
        {(phase === "idle" || isSlots || phase === "no_slots") && (
          <>
            <div style={{ display: "flex", gap: 0, marginBottom: 18, borderBottom: "1px solid #222" }}>
              {(["recommended", "manual"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setPhase("idle"); }}
                  style={{
                    padding: "7px 16px", border: "none", background: "transparent",
                    color: tab === t ? "#C084FC" : "#555",
                    fontWeight: tab === t ? 700 : 400,
                    fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                    borderBottom: tab === t ? "2px solid #A855F7" : "2px solid transparent",
                    marginBottom: -1, transition: "all 0.13s",
                  }}
                >
                  {t === "recommended" ? "זמנים מומלצים" : "בחר ידנית"}
                </button>
              ))}
            </div>

            {/* ── Recommended tab ─────────────────────────────────── */}
            {tab === "recommended" && (
              <>
                {phase === "idle" && (
                  <Btn primary onClick={findSlots}>🗓 מצא זמן פנוי ביומן</Btn>
                )}

                {isSlots && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 6 }}>
                    <Label>בחר זמן</Label>
                    {(phase as { slots: FreeSlot[] }).slots.map((slot) => (
                      <SlotButton
                        key={slot.start}
                        label={slot.label}
                        onSelect={() => checkAndConfirm(slot.start, slot.end, slot.label)}
                      />
                    ))}
                  </div>
                )}

                {phase === "no_slots" && (
                  <>
                    <div style={{ color: "#888", fontSize: 13, marginBottom: 14 }}>
                      אין חלון פנוי מתאים ב-14 הימים הקרובים.
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <Btn onClick={findSlots}>נסה שוב</Btn>
                      <Btn onClick={onClose}>סגור</Btn>
                    </div>
                  </>
                )}
              </>
            )}

            {/* ── Manual tab ──────────────────────────────────────── */}
            {tab === "manual" && (
              <ManualPicker
                manualDate={manualDate}
                todayStr={todayStr}
                manualDayOk={manualDayOk}
                manualHM={manualHM}
                timeOptions={timeOptions}
                manualEndHM={manualEndHM}
                manualHoursOk={manualHoursOk}
                manualReady={manualReady}
                onDateChange={(v) => { setManualDate(v); setManualHM(null); setPhase("idle"); }}
                onHMChange={(hm) => { setManualHM(hm); setPhase("idle"); }}
                onConfirm={() => {
                  if (!manualStart || !manualEnd) return;
                  const label = confirmLabel(manualStart, manualEnd);
                  checkAndConfirm(manualStart.toISOString(), manualEnd.toISOString(), label);
                }}
              />
            )}
          </>
        )}

        {/* ── Checking ────────────────────────────────────────────── */}
        {phase === "checking" && <Spinner label="בודק זמינות..." />}

        {/* ── Searching ───────────────────────────────────────────── */}
        {phase === "searching" && <Spinner label="מחפש חלונות פנויים..." />}

        {/* ── Creating ────────────────────────────────────────────── */}
        {phase === "creating" && <Spinner label="יוצר אירוע ביומן..." />}

        {/* ── Confirm ─────────────────────────────────────────────── */}
        {isConfirm && confirmData && (
          <ConfirmPanel
            data={confirmData}
            action={action}
            artist={artist}
            projectName={projectName}
            sendToArtist={sendToArtist}
            setSendToArtist={setSendToArtist}
            artistEmail={artistEmail}
            setArtistEmail={(v) => { setArtistEmail(v); setEmailFromClients(false); }}
            emailFromClients={emailFromClients}
            publicTitle={publicTitle}
            onBack={() => setPhase("idle")}
            onCreate={() => createEvent(confirmData.start, confirmData.end, confirmData.label)}
            onForce={() => createEvent(confirmData.start, confirmData.end, confirmData.label)}
          />
        )}

        {/* ── Created ─────────────────────────────────────────────── */}
        {isCreated && createdData && (
          <CreatedPanel
            data={createdData}
            action={action}
            artist={artist}
            projectName={projectName}
            onClose={onClose}
          />
        )}

        {/* ── Error ───────────────────────────────────────────────── */}
        {isError && errorData && (
          <>
            <div style={{
              background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 12, padding: "12px 16px", color: "#EF4444",
              fontSize: 13, marginBottom: 18,
            }}>
              {errorData.error}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {errorData.needsReauth && (
                <Link href="/setup/calendar" style={{ ...PRIMARY_STYLE, textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  חבר מחדש
                </Link>
              )}
              <Btn onClick={() => setPhase("idle")}>חזור</Btn>
            </div>
          </>
        )}

        {/* ── Bottom cancel (idle states) ──────────────────────────── */}
        {(phase === "idle" || isSlots || phase === "no_slots") && (
          <div style={{ marginTop: 16 }}>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#444", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
              ביטול
            </button>
          </div>
        )}

      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ManualPicker({
  manualDate, todayStr, manualDayOk, manualHM, timeOptions,
  manualEndHM, manualHoursOk, manualReady,
  onDateChange, onHMChange, onConfirm,
}: {
  manualDate: string; todayStr: string; manualDayOk: boolean;
  manualHM: { h: number; m: number } | null;
  timeOptions: { h: number; m: number }[];
  manualEndHM: { h: number; m: number } | null;
  manualHoursOk: boolean; manualReady: boolean;
  onDateChange: (v: string) => void;
  onHMChange: (hm: { h: number; m: number }) => void;
  onConfirm: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Date */}
      <div>
        <Label>תאריך</Label>
        <input
          type="date"
          value={manualDate}
          min={todayStr}
          onChange={(e) => onDateChange(e.target.value)}
          style={{
            width: "100%", padding: "9px 12px", borderRadius: 10,
            border: `1px solid ${manualDayOk ? "#303030" : "rgba(239,68,68,0.4)"}`,
            background: "#111", color: "#E8E8E8", fontSize: 13,
            fontFamily: "inherit", outline: "none", boxSizing: "border-box",
          }}
        />
        {!manualDayOk && (
          <Warning>זה מחוץ לימי הפעילות (ראשון–חמישי). בחר יום אחר.</Warning>
        )}
      </div>

      {/* Start time */}
      {manualDayOk && (
        <div>
          <Label>שעת התחלה</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {timeOptions.map((t) => (
              <Pill
                key={`${t.h}:${t.m}`}
                active={manualHM?.h === t.h && manualHM?.m === t.m}
                onClick={() => onHMChange(t)}
                small
              >
                {fmtHM(t.h, t.m)}
              </Pill>
            ))}
          </div>
        </div>
      )}

      {/* End time display */}
      {manualHM && manualEndHM && (
        <div style={{
          background: "#111", border: `1px solid ${manualHoursOk ? "#2A2A2A" : "rgba(239,68,68,0.35)"}`,
          borderRadius: 10, padding: "10px 14px",
        }}>
          <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>זמן האירוע</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: manualHoursOk ? "#E8E8E8" : "#EF4444" }}>
            {fmtHM(manualHM.h, manualHM.m)} – {fmtHM(manualEndHM.h, manualEndHM.m)}
          </div>
          {!manualHoursOk && (
            <div style={{ fontSize: 12, color: "#EF4444", marginTop: 4 }}>
              האירוע מסתיים אחרי {WORK_END_H}:00. בחר שעה מוקדמת יותר.
            </div>
          )}
        </div>
      )}

      {/* Proceed */}
      {manualReady && manualHM && (
        <Btn primary onClick={onConfirm}>בדוק זמינות ↓</Btn>
      )}
    </div>
  );
}

function ConfirmPanel({
  data, action, artist, projectName,
  sendToArtist, setSendToArtist, artistEmail, setArtistEmail, emailFromClients,
  publicTitle, onBack, onCreate, onForce,
}: {
  data: { start: string; end: string; label: string; hardConflict: boolean; bufferWarning: boolean; conflictNames: string[]; forceCreate: boolean };
  action: ActionDef; artist: string; projectName: string;
  sendToArtist: boolean; setSendToArtist: (v: boolean) => void;
  artistEmail: string; setArtistEmail: (v: string) => void;
  emailFromClients: boolean;
  publicTitle: string;
  onBack: () => void; onCreate: () => void; onForce: () => void;
}) {
  const hasWarning = data.hardConflict || data.bufferWarning;
  const emailValid = !sendToArtist || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(artistEmail.trim());
  const canCreate  = emailValid;

  return (
    <div>
      {/* ── Internal summary ─────────────────────────────────────── */}
      <div style={{
        background: "#111", border: "1px solid #2A2A2A", borderRadius: 14,
        padding: "16px", marginBottom: 14,
      }}>
        <div style={{ fontSize: 10, color: "#555", marginBottom: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          אישור יצירת אירוע
        </div>
        <Row label="פעולה"   value={action.calPrefix} />
        <Row label="אמן"     value={artist} />
        <Row label="פרויקט"  value={projectName} />
        <Row label="זמן"     value={data.label} highlight />
      </div>

      {/* ── Artist invite section ─────────────────────────────────── */}
      <div style={{
        background: sendToArtist ? "rgba(168,85,247,0.06)" : "#111",
        border: `1px solid ${sendToArtist ? "rgba(168,85,247,0.25)" : "#222"}`,
        borderRadius: 14, padding: "14px 16px", marginBottom: 14,
        transition: "all 0.2s",
      }}>
        {/* Checkbox */}
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}>
          <div
            onClick={() => setSendToArtist(!sendToArtist)}
            style={{
              width: 18, height: 18, borderRadius: 5, flexShrink: 0,
              border: `1.5px solid ${sendToArtist ? "#A855F7" : "#333"}`,
              background: sendToArtist ? "rgba(168,85,247,0.2)" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s", cursor: "pointer",
            }}
          >
            {sendToArtist && <span style={{ color: "#C084FC", fontSize: 12, lineHeight: 1 }}>✓</span>}
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: sendToArtist ? "#C084FC" : "#888" }}>
            שלח הזמנה לאמן במייל
          </span>
        </label>

        {sendToArtist && (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Artist email */}
            <div>
              <div style={{ fontSize: 10, color: "#666", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
                אימייל האמן
              </div>
              <input
                type="email"
                value={artistEmail}
                onChange={(e) => setArtistEmail(e.target.value)}
                placeholder="artist@example.com"
                dir="ltr"
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 9,
                  border: `1px solid ${artistEmail && !emailValid ? "rgba(239,68,68,0.5)" : "#303030"}`,
                  background: "#0D0D0D", color: "#E8E8E8",
                  fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
                }}
              />
              {artistEmail && !emailValid && (
                <div style={{ fontSize: 11, color: "#EF4444", marginTop: 4 }}>כתובת מייל לא תקינה</div>
              )}
              {emailFromClients && artistEmail && emailValid && (
                <div style={{ fontSize: 11, color: "#34D399", marginTop: 4 }}>✓ מולא אוטומטית מרשימת הלקוחות</div>
              )}
            </div>

            {/* Preview */}
            <div style={{
              background: "#0D0D0D", border: "1px solid #222", borderRadius: 9,
              padding: "10px 12px", fontSize: 11, color: "#555",
            }}>
              <div style={{ marginBottom: 4 }}>מה האמן יקבל:</div>
              <div style={{ color: "#C084FC", fontWeight: 600, fontSize: 12 }}>{publicTitle}</div>
              <div style={{ color: "#666", marginTop: 6, lineHeight: 1.7, whiteSpace: "pre" }}>{`שם אמן: ${artist}\nשם פרויקט: ${projectName}`}</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Warnings ─────────────────────────────────────────────── */}
      {data.hardConflict && (
        <WarnBox icon="⚠">
          יש אירוע אחר בזמן הזה{data.conflictNames.length > 0 ? `: "${data.conflictNames[0]}"` : ""}.
        </WarnBox>
      )}
      {!data.hardConflict && data.bufferWarning && (
        <WarnBox icon="⏱">
          אין מרווח של 30 דקות לפני/אחרי האירוע.
        </WarnBox>
      )}

      {/* ── Buttons ──────────────────────────────────────────────── */}
      {!hasWarning && (
        <div style={{ display: "flex", gap: 10 }}>
          <Btn primary onClick={onCreate} disabled={!canCreate}>
            {sendToArtist ? "✓ צור ושלח הזמנה לאמן" : "✓ צור אירוע ביומן"}
          </Btn>
          <Btn onClick={onBack}>חזור</Btn>
        </div>
      )}

      {hasWarning && (
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <Btn onClick={onBack}>בחר זמן אחר</Btn>
          <Btn primary onClick={onForce} disabled={!canCreate}>צור בכל זאת</Btn>
        </div>
      )}
    </div>
  );
}

function CreatedPanel({
  data, action, artist, projectName, onClose,
}: {
  data: { label: string; htmlLink?: string; inviteSent?: boolean };
  action: ActionDef; artist: string; projectName: string;
  onClose: () => void;
}) {
  return (
    <div>
      <div style={{
        background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.2)",
        borderRadius: 14, padding: "16px", marginBottom: 20,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#10B981", marginBottom: 10 }}>
          ✓ האירוע נוצר ביומן
        </div>
        <Row label="פעולה"  value={action.calPrefix} />
        <Row label="אמן"    value={artist} />
        <Row label="פרויקט" value={projectName} />
        <Row label="זמן"    value={data.label} highlight />
        {data.inviteSent && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#A855F7", fontWeight: 600 }}>
            ✉️ הזמנה נשלחה לאמן במייל
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {data.htmlLink && (
          <a href={data.htmlLink} target="_blank" rel="noopener noreferrer" style={{ ...SECONDARY_STYLE, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            פתח ביומן ↗
          </a>
        )}
        <Btn primary onClick={onClose}>סגור</Btn>
      </div>
    </div>
  );
}

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function SlotButton({ label, onSelect }: { label: string; onSelect: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: "11px 16px", borderRadius: 12, cursor: "pointer",
        border: `1.5px solid ${hov ? "rgba(168,85,247,0.45)" : "#222"}`,
        background: hov ? "rgba(168,85,247,0.10)" : "#1A1A1A",
        color: hov ? "#C084FC" : "#C0C0C0",
        fontSize: 13, textAlign: "right", fontFamily: "inherit",
        transition: "all 0.13s", direction: "rtl", width: "100%",
      }}
    >
      {label}
    </button>
  );
}

function Spinner({ label }: { label: string }) {
  return <div style={{ color: "#555", fontSize: 13 }}>{label}</div>;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, color: "#777", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
      {children}
    </div>
  );
}

function Sep() {
  return <span style={{ fontSize: 13, color: "#3A3A3A" }}>—</span>;
}

function Warning({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: "#F97316", marginTop: 6 }}>{children}</div>;
}

function WarnBox({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)",
      borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#F59E0B",
      marginBottom: 12, display: "flex", gap: 8, alignItems: "flex-start",
    }}>
      <span>{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, gap: 12 }}>
      <span style={{ fontSize: 12, color: "#555" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: highlight ? 700 : 500, color: highlight ? "#C084FC" : "#D0D0D0", textAlign: "left", direction: "ltr" }}>
        {value}
      </span>
    </div>
  );
}

function Pill({ children, active, onClick, small }: {
  children: React.ReactNode; active: boolean; onClick: () => void; small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: small ? "5px 11px" : "8px 16px",
        borderRadius: 100,
        border: `1.5px solid ${active ? "rgba(168,85,247,0.55)" : "#252525"}`,
        background: active ? "rgba(168,85,247,0.14)" : "#1C1C1C",
        color: active ? "#C084FC" : "#B0B0B0",
        fontSize: small ? 12 : 13, fontWeight: active ? 700 : 400,
        cursor: "pointer", fontFamily: "inherit", transition: "all 0.14s",
      }}
    >
      {children}
    </button>
  );
}

function Btn({ children, primary, onClick, disabled, style }: {
  children: React.ReactNode; primary?: boolean; onClick?: () => void;
  disabled?: boolean; style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...(primary ? PRIMARY_STYLE : SECONDARY_STYLE), ...style }}
    >
      {children}
    </button>
  );
}

const PRIMARY_STYLE: React.CSSProperties = {
  padding: "10px 20px", borderRadius: 100,
  border: "1.5px solid rgba(168,85,247,0.4)",
  background: "rgba(168,85,247,0.14)", color: "#C084FC",
  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};

const SECONDARY_STYLE: React.CSSProperties = {
  padding: "10px 20px", borderRadius: 100,
  border: "1.5px solid #383838", background: "#1E1E1E",
  color: "#999", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};
