"use client";

import { useEffect, useMemo, useState } from "react";
import type { Show, ShowStatus, PaymentStatus } from "@/lib/shows-types";
import { SHOW_STATUSES, PAYMENT_STATUSES } from "@/lib/shows-types";

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG      = "#080808";
const BG2     = "#101010";
const CARD    = "rgba(255,255,255,0.032)";
const CARD2   = "rgba(255,255,255,0.06)";
const BDR     = "rgba(255,255,255,0.08)";
const BDR2    = "rgba(255,255,255,0.14)";
const TEXT    = "#F2F2F2";
const TEXT2   = "#A0A0B0";
const MUTED   = "#52526A";
const BRAND   = "#DC2626";
const GREEN   = "#10B981";
const AMBER   = "#F59E0B";
const BLUE    = "#3B82F6";
const PURPLE  = "#8B5CF6";

// ─── Status colours ───────────────────────────────────────────────────────────
const STATUS_COLOR: Record<ShowStatus, { bg: string; text: string }> = {
  "ליד חדש":      { bg: "rgba(59,130,246,0.18)",  text: "#60A5FA" },
  "ממתין לתשובה": { bg: "rgba(245,158,11,0.18)",  text: "#F59E0B" },
  "צריך פולואפ":  { bg: "rgba(239,68,68,0.18)",   text: "#EF4444" },
  "נסגר":         { bg: "rgba(16,185,129,0.18)",  text: "#10B981" },
  "בוצע":         { bg: "rgba(167,139,250,0.18)", text: "#A78BFA" },
  "בוטל":         { bg: "rgba(107,114,128,0.18)", text: "#6B7280" },
};
const PAY_COLOR: Record<PaymentStatus, { bg: string; text: string }> = {
  "לא שולם": { bg: "rgba(239,68,68,0.18)",   text: "#EF4444" },
  "חלקי":    { bg: "rgba(245,158,11,0.18)",  text: "#F59E0B" },
  "שולם":    { bg: "rgba(16,185,129,0.18)",  text: "#10B981" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtIls(n: number) { return `₪${n.toLocaleString("he-IL")}`; }

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  const months = ["","ינו","פבר","מרץ","אפר","מאי","יוני","יולי","אוג","ספט","אוק","נוב","דצ"];
  return `${parseInt(day, 10)} ${months[parseInt(m, 10)]}`;
}

function fmtDay(d: string | null): string {
  if (!d) return "—";
  const days = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
  return days[new Date(d).getDay()];
}

function isUpcoming(d: string | null): boolean {
  if (!d) return false;
  return new Date(d) >= new Date(new Date().toDateString());
}

function calcDistributable(s: Show) { return Math.max(0, s.show_price - s.dj_fee); }
function calcLabelShare(s: Show)    { return calcDistributable(s) / 2; }
function calcArtistShare(s: Show)   { return calcDistributable(s) / 2; }
function calcRemaining(s: Show)     { return Math.max(0, s.show_price - s.advance_payment); }

// ─── Sub-components ──────────────────────────────────────────────────────────
function Badge({ bg, text, children }: { bg: string; text: string; children: React.ReactNode }) {
  return (
    <span style={{
      background: bg, color: text, borderRadius: 100,
      padding: "3px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
      border: `1px solid ${text}30`,
    }}>{children}</span>
  );
}

// ─── Decorative concert gradient backgrounds ──────────────────────────────────
const CARD_GRADS = [
  "linear-gradient(145deg,#1a0606 0%,#2d0a0a 50%,#0d0d0d 100%)",
  "linear-gradient(145deg,#060a1a 0%,#0d1a2d 50%,#0d0d0d 100%)",
  "linear-gradient(145deg,#0a1a0a 0%,#0d2d0d 50%,#0d0d0d 100%)",
  "linear-gradient(145deg,#1a060a 0%,#2d0d0d 50%,#0d0d0d 100%)",
  "linear-gradient(145deg,#0a0a1a 0%,#150d2d 50%,#0d0d0d 100%)",
];
const CARD_ACCENTS = [BRAND, BLUE, GREEN, "#E879F9", AMBER];

// ─── Show Card (upcoming section) ────────────────────────────────────────────
function ShowCard({ show, accent, grad, onClick, selected }: {
  show: Show;
  accent: string;
  grad: string;
  onClick: () => void;
  selected: boolean;
}) {
  const labelShare  = calcLabelShare(show);
  const artistShare = calcArtistShare(show);

  return (
    <div
      onClick={onClick}
      style={{
        minWidth: 230, maxWidth: 260, flex: "0 0 245px",
        borderRadius: 16,
        background: grad,
        border: `1px solid ${selected ? accent : BDR}`,
        boxShadow: selected ? `0 0 0 2px ${accent}40, 0 8px 32px rgba(0,0,0,0.5)` : "0 4px 20px rgba(0,0,0,0.4)",
        cursor: "pointer",
        overflow: "hidden",
        transition: "none",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Cover area */}
      <div style={{ height: 110, position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* Decorative crowd silhouette */}
        <div style={{
          position: "absolute", inset: 0,
          background: `radial-gradient(ellipse at 50% 60%, ${accent}28 0%, transparent 70%)`,
        }} />
        <svg viewBox="0 0 260 80" style={{ position: "absolute", bottom: 0, width: "100%", opacity: 0.18 }} preserveAspectRatio="none">
          <ellipse cx="30"  cy="80" rx="18" ry="28" fill={accent} />
          <ellipse cx="60"  cy="80" rx="22" ry="34" fill={accent} />
          <ellipse cx="90"  cy="80" rx="20" ry="30" fill={accent} />
          <ellipse cx="120" cy="80" rx="25" ry="40" fill={accent} />
          <ellipse cx="150" cy="80" rx="20" ry="32" fill={accent} />
          <ellipse cx="180" cy="80" rx="22" ry="35" fill={accent} />
          <ellipse cx="210" cy="80" rx="18" ry="28" fill={accent} />
          <ellipse cx="240" cy="80" rx="16" ry="22" fill={accent} />
        </svg>
        {/* Date badge */}
        <div style={{
          position: "absolute", top: 10, right: 10,
          background: accent, borderRadius: 10,
          padding: "4px 10px", textAlign: "center", minWidth: 40,
        }}>
          {show.date ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#fff", lineHeight: 1 }}>
                {parseInt(show.date.split("-")[2], 10)}
              </div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.85)", letterSpacing: "0.05em" }}>
                {["","ינו","פבר","מרץ","אפר","מאי","יוני","יולי","אוג","ספט","אוק","נוב","דצ"][parseInt(show.date.split("-")[1], 10)]}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11, color: "#fff" }}>—</div>
          )}
        </div>
        {/* Day of week */}
        {show.date && (
          <div style={{ position: "absolute", bottom: 8, right: 10, fontSize: 10, color: `${accent}CC`, fontWeight: 600 }}>
            {fmtDay(show.date)}
          </div>
        )}
        {/* Stage light glow */}
        <div style={{
          position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)",
          width: 120, height: 60,
          background: `radial-gradient(ellipse, ${accent}22 0%, transparent 70%)`,
        }} />
      </div>

      {/* Body */}
      <div style={{ padding: "12px 14px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, lineHeight: 1.2, marginBottom: 2 }}>{show.name}</div>
        <div style={{ fontSize: 12, color: TEXT2, fontWeight: 600 }}>{show.artist || "—"}</div>
        <div style={{ fontSize: 11, color: MUTED }}>
          {show.location || "—"}{show.start_time ? ` · ${show.start_time}` : ""}
        </div>

        <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
          <Badge bg={STATUS_COLOR[show.status].bg} text={STATUS_COLOR[show.status].text}>{show.status}</Badge>
          <Badge bg={PAY_COLOR[show.payment_status].bg} text={PAY_COLOR[show.payment_status].text}>{show.payment_status}</Badge>
        </div>

        {/* Finance mini row */}
        <div style={{ display: "flex", gap: 8, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BDR}` }}>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: TEXT }}>{fmtIls(show.show_price)}</div>
            <div style={{ fontSize: 9, color: MUTED }}>מחיר</div>
          </div>
          <div style={{ width: 1, background: BDR }} />
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: AMBER }}>{fmtIls(artistShare)}</div>
            <div style={{ fontSize: 9, color: MUTED }}>אמן</div>
          </div>
          <div style={{ width: 1, background: BDR }} />
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: GREEN }}>{fmtIls(labelShare)}</div>
            <div style={{ fontSize: 9, color: MUTED }}>לייבל</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, icon }: {
  label: string; value: string | number; sub: string; color: string; icon: string;
}) {
  return (
    <div style={{
      background: CARD, border: `1px solid ${BDR}`,
      borderTop: `2px solid ${color}`,
      borderRadius: 14, padding: "16px 18px", flex: 1,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", bottom: -6, left: -4, fontSize: 48, opacity: 0.06, userSelect: "none", lineHeight: 1 }}>{icon}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: TEXT2, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: `${color}18`, border: `1px solid ${color}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{icon}</div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: MUTED }}>{sub}</div>
    </div>
  );
}

// ─── Side Panel ───────────────────────────────────────────────────────────────
function ShowPanel({ show, onClose }: { show: Show; onClose: () => void }) {
  const distributable = calcDistributable(show);
  const artist        = calcArtistShare(show);
  const label         = calcLabelShare(show);
  const remaining     = calcRemaining(show);

  return (
    <div style={{
      width: 380, minWidth: 340, flexShrink: 0,
      background: BG2, border: `1px solid ${BDR2}`,
      borderRadius: 18, overflow: "hidden",
      display: "flex", flexDirection: "column",
      boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
    }}>
      {/* Panel header */}
      <div style={{ padding: "18px 20px 14px", borderBottom: `1px solid ${BDR}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, marginBottom: 3 }}>{show.name}</div>
          <div style={{ fontSize: 12, color: TEXT2 }}>{show.artist || "—"}</div>
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "none", cursor: "pointer",
          color: MUTED, fontSize: 18, lineHeight: 1, padding: "2px 4px",
          transition: "none",
        }}>✕</button>
      </div>

      {/* Body */}
      <div style={{ padding: "16px 20px", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>

        {/* Badges */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Badge bg={STATUS_COLOR[show.status].bg} text={STATUS_COLOR[show.status].text}>{show.status}</Badge>
          <Badge bg={PAY_COLOR[show.payment_status].bg} text={PAY_COLOR[show.payment_status].text}>{show.payment_status}</Badge>
          {show.calendar_event_id && (
            <Badge bg="rgba(59,130,246,0.18)" text={BLUE}>📅 ביומן</Badge>
          )}
        </div>

        {/* Date / time / location */}
        <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { label: "תאריך", value: show.date ? `${fmtDate(show.date)} · ${fmtDay(show.date)}` : "—" },
            { label: "שעה", value: show.start_time || "—" },
            { label: "מיקום", value: show.location || "—" },
            show.contact_person ? { label: "איש קשר", value: show.contact_person } : null,
            show.phone ? { label: "טלפון", value: show.phone } : null,
          ].filter(Boolean).map((r) => (
            <div key={r!.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: MUTED }}>{r!.label}</span>
              <span style={{ color: TEXT, fontWeight: 600 }}>{r!.value}</span>
            </div>
          ))}
        </div>

        {/* Finance breakdown */}
        <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: TEXT2, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>כספים</div>
          {[
            { label: "מחיר הופעה",     value: fmtIls(show.show_price),   color: TEXT },
            { label: "DJ fee",          value: `−${fmtIls(show.dj_fee)}`, color: MUTED },
            { label: "יתרה לחלוקה",    value: fmtIls(distributable),      color: AMBER,  bold: true },
            { label: "חלק אמן (50%)",  value: fmtIls(artist),            color: BLUE },
            { label: "חלק לייבל (50%)",value: fmtIls(label),             color: GREEN },
            { label: "מקדמה ששולמה",   value: fmtIls(show.advance_payment), color: TEXT },
            { label: "יתרה לגבייה",    value: fmtIls(remaining),          color: remaining > 0 ? BRAND : GREEN, bold: true },
          ].map(r => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 7 }}>
              <span style={{ color: MUTED }}>{r.label}</span>
              <span style={{ color: r.color, fontWeight: r.bold ? 800 : 600 }}>{r.value}</span>
            </div>
          ))}
        </div>

        {/* Notes */}
        {show.notes && (
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: TEXT2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>הערות</div>
            <div style={{ fontSize: 12, color: TEXT2, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{show.notes}</div>
          </div>
        )}

        {/* Booker */}
        {show.booker_name && (
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: TEXT2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>מזמין</div>
            <div style={{ fontSize: 12, color: TEXT }}>{show.booker_name}</div>
          </div>
        )}

        {/* Disabled action buttons */}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button disabled style={{
            flex: 1, padding: "9px 0", borderRadius: 10, fontSize: 12, fontWeight: 700,
            background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}`,
            color: MUTED, cursor: "not-allowed", transition: "none",
          }}>✏️ עריכה</button>
          <button disabled style={{
            flex: 1, padding: "9px 0", borderRadius: 10, fontSize: 12, fontWeight: 700,
            background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}`,
            color: MUTED, cursor: "not-allowed", transition: "none",
          }}>📅 הוסף ליומן</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function ShowsHubPreview() {
  const [shows,     setShows]     = useState<Show[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [search,    setSearch]    = useState("");
  const [filterSt,  setFilterSt]  = useState<ShowStatus | "">("");
  const [filterPay, setFilterPay] = useState<PaymentStatus | "">("");
  const [selected,  setSelected]  = useState<Show | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/shows")
      .then(r => r.json())
      .then(d => { setShows(Array.isArray(d.shows) ? d.shows : []); setLoading(false); })
      .catch(() => { setError("לא הצלחנו לטעון הופעות"); setLoading(false); });
  }, []);

  const upcoming = useMemo(() =>
    [...shows]
      .filter(s => isUpcoming(s.date) && s.status !== "בוטל")
      .sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9"))
      .slice(0, 8),
    [shows]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return shows.filter(s => {
      if (filterSt  && s.status         !== filterSt)  return false;
      if (filterPay && s.payment_status !== filterPay) return false;
      if (q && !`${s.name} ${s.artist} ${s.location} ${s.booker_name}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [shows, search, filterSt, filterPay]);

  // KPI calculations
  const kpis = useMemo(() => {
    const active  = shows.filter(s => s.status !== "בוטל");
    const upCount = upcoming.length;
    const expIncome  = active.reduce((a, s) => a + s.show_price, 0);
    const remaining  = active.reduce((a, s) => a + calcRemaining(s), 0);
    const labelProfit = active.reduce((a, s) => a + calcLabelShare(s), 0);
    return { total: shows.length, upCount, expIncome, remaining, labelProfit };
  }, [shows, upcoming]);

  const selectStyle: React.CSSProperties = {
    background: CARD, border: `1px solid ${BDR2}`, color: TEXT2,
    borderRadius: 9, padding: "7px 10px", fontSize: 12, fontFamily: "inherit",
    outline: "none", cursor: "pointer", direction: "rtl",
  };

  // ── Hero BG colours cycling through shows ─────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh", background: BG, color: TEXT,
      fontFamily: "'Heebo', Arial, sans-serif",
      direction: "rtl",
    }}>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div style={{
        position: "relative", overflow: "hidden",
        background: "linear-gradient(180deg, #1a0606 0%, #0d0505 40%, #080808 100%)",
        borderBottom: `1px solid rgba(220,38,38,0.22)`,
        padding: "32px 32px 28px",
      }}>
        {/* glow orbs */}
        <div style={{ position: "absolute", top: -40, right: "15%", width: 300, height: 200, background: "radial-gradient(ellipse, rgba(220,38,38,0.18) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -30, left: "20%", width: 200, height: 120, background: "radial-gradient(ellipse, rgba(220,38,38,0.10) 0%, transparent 70%)", pointerEvents: "none" }} />

        {/* Crowd silhouette */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 60, opacity: 0.07 }}>
          <svg viewBox="0 0 1200 60" style={{ width: "100%", height: "100%" }} preserveAspectRatio="none">
            {Array.from({ length: 60 }).map((_, i) => (
              <ellipse key={i} cx={i * 20 + 10} cy={60} rx={7 + (i % 3) * 3} ry={12 + (i % 5) * 5} fill={BRAND} />
            ))}
          </svg>
        </div>

        <div style={{ position: "relative", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {/* Preview badge */}
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.35)",
              borderRadius: 100, padding: "3px 12px", fontSize: 10, fontWeight: 700,
              color: "#F87171", letterSpacing: "0.07em", marginBottom: 6, width: "fit-content",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#F87171", display: "inline-block" }} />
              PREVIEW / עיצוב בלבד
            </div>

            {/* Title row */}
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ fontSize: 34, fontWeight: 900, color: TEXT, letterSpacing: "-0.02em", lineHeight: 1 }}>הופעות הלייבל</div>
              <span style={{ fontSize: 30 }}>🎤</span>
            </div>
            <div style={{ fontSize: 13, color: TEXT2, marginTop: 4 }}>
              ניהול כל ההופעות של הלייבל, תאריכים, סטטוסים, הזמנות ותשלומים.
            </div>
          </div>

          {/* New show button — visual only */}
          <button
            style={{
              display: "flex", alignItems: "center", gap: 7,
              background: BRAND, border: "none", borderRadius: 11,
              padding: "10px 20px", fontSize: 13, fontWeight: 700,
              color: "#fff", cursor: "default", transition: "none",
              boxShadow: "0 4px 18px rgba(220,38,38,0.4)",
              flexShrink: 0, marginTop: 6,
            }}
            title="Visual only — read-only preview"
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> הופעה חדשה
          </button>
        </div>
      </div>

      <div style={{ padding: "24px 32px 60px" }}>

        {/* ── KPI strip ──────────────────────────────────────────────────── */}
        {!loading && !error && (
          <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
            <KpiCard label="סה״כ הופעות"       value={kpis.total}             sub="הופעות רשומות"       color={BRAND}  icon="🎤" />
            <KpiCard label="הופעות קרובות"      value={kpis.upCount}           sub="ב-30 הימים הקרובים"  color={BLUE}   icon="📅" />
            <KpiCard label="הכנסות צפויות"      value={fmtIls(kpis.expIncome)}   sub="מהופעות פעילות"      color={GREEN}  icon="💰" />
            <KpiCard label="יתרה לגבייה"        value={fmtIls(kpis.remaining)}   sub="טרם שולם"            color={AMBER}  icon="⏳" />
            <KpiCard label="רווח לייבל צפוי"    value={fmtIls(kpis.labelProfit)} sub="50% מיתרה לחלוקה"   color={PURPLE} icon="🏷️" />
          </div>
        )}

        {/* ── Main area (table + panel) ───────────────────────────────────── */}
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>

            {/* ── Loading / error ─────────────────────────────────────────── */}
            {loading && (
              <div style={{ textAlign: "center", padding: "60px 0", color: TEXT2 }}>
                <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>🎤</div>
                <div>טוען הופעות…</div>
              </div>
            )}
            {error && (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#EF4444" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
                <div>{error}</div>
              </div>
            )}

            {!loading && !error && (
              <>
                {/* ── Upcoming cards ────────────────────────────────────── */}
                {upcoming.length > 0 && (
                  <div style={{ marginBottom: 28 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>הופעות קרובות</div>
                      <div style={{
                        padding: "2px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                        background: `${BLUE}18`, border: `1px solid ${BLUE}35`, color: BLUE,
                      }}>{upcoming.length}</div>
                    </div>
                    <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
                      {upcoming.map((s, i) => (
                        <ShowCard
                          key={s.id}
                          show={s}
                          accent={CARD_ACCENTS[i % CARD_ACCENTS.length]}
                          grad={CARD_GRADS[i % CARD_GRADS.length]}
                          selected={selected?.id === s.id}
                          onClick={() => setSelected(prev => prev?.id === s.id ? null : s)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* ── All shows table ───────────────────────────────────── */}
                <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, overflow: "hidden" }}>
                  {/* Table header */}
                  <div style={{ padding: "16px 20px 14px", borderBottom: `1px solid ${BDR}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>כל ההופעות</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {/* Search */}
                      <div style={{ position: "relative" }}>
                        <input
                          value={search}
                          onChange={e => setSearch(e.target.value)}
                          placeholder="חיפוש הופעה..."
                          style={{
                            ...selectStyle,
                            paddingRight: 30, width: 180,
                            background: BG2, color: TEXT,
                          }}
                        />
                        <span style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 13, pointerEvents: "none" }}>🔍</span>
                      </div>
                      {/* Status filter */}
                      <select value={filterSt} onChange={e => setFilterSt(e.target.value as ShowStatus | "")} style={{ ...selectStyle, background: BG2 }}>
                        <option value="">כל הסטטוסים</option>
                        {SHOW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {/* Payment filter */}
                      <select value={filterPay} onChange={e => setFilterPay(e.target.value as PaymentStatus | "")} style={{ ...selectStyle, background: BG2 }}>
                        <option value="">כל התשלומים</option>
                        {PAYMENT_STATUSES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Table */}
                  {filtered.length === 0 ? (
                    <div style={{ padding: "48px 0", textAlign: "center", color: MUTED }}>
                      <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.25 }}>🎤</div>
                      <div style={{ fontSize: 13 }}>אין הופעות להצגה</div>
                    </div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${BDR}` }}>
                            {["הופעה","תאריך","מיקום","סטטוס","תשלום","מחיר","מקדמה","יתרה","רווח לייבל","פעולות"].map(h => (
                              <th key={h} style={{
                                padding: "10px 14px", textAlign: "right",
                                fontSize: 10, fontWeight: 700, color: MUTED,
                                textTransform: "uppercase", letterSpacing: "0.07em",
                                whiteSpace: "nowrap",
                              }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((s, i) => {
                            const isSelected = selected?.id === s.id;
                            const rowBg = isSelected ? "rgba(220,38,38,0.06)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)";
                            return (
                              <tr
                                key={s.id}
                                onClick={() => setSelected(prev => prev?.id === s.id ? null : s)}
                                style={{
                                  borderBottom: `1px solid ${BDR}`,
                                  background: rowBg,
                                  cursor: "pointer",
                                  outline: isSelected ? `1px solid rgba(220,38,38,0.30)` : "none",
                                  outlineOffset: -1,
                                }}
                              >
                                {/* הופעה */}
                                <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                                  <div style={{ fontWeight: 700, color: TEXT }}>{s.name}</div>
                                  {s.artist && <div style={{ fontSize: 11, color: TEXT2 }}>{s.artist}</div>}
                                </td>
                                {/* תאריך */}
                                <td style={{ padding: "12px 14px", color: TEXT2, whiteSpace: "nowrap" }}>
                                  {s.date ? (
                                    <>
                                      <div style={{ fontWeight: 600, color: TEXT }}>{fmtDate(s.date)}</div>
                                      <div style={{ fontSize: 10, color: MUTED }}>{fmtDay(s.date)}{s.start_time ? ` · ${s.start_time}` : ""}</div>
                                    </>
                                  ) : "—"}
                                </td>
                                {/* מיקום */}
                                <td style={{ padding: "12px 14px", color: TEXT2, whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{s.location || "—"}</td>
                                {/* סטטוס */}
                                <td style={{ padding: "12px 14px" }}>
                                  <Badge bg={STATUS_COLOR[s.status].bg} text={STATUS_COLOR[s.status].text}>{s.status}</Badge>
                                </td>
                                {/* תשלום */}
                                <td style={{ padding: "12px 14px" }}>
                                  <Badge bg={PAY_COLOR[s.payment_status].bg} text={PAY_COLOR[s.payment_status].text}>{s.payment_status}</Badge>
                                </td>
                                {/* מחיר */}
                                <td style={{ padding: "12px 14px", color: TEXT, fontWeight: 700, whiteSpace: "nowrap" }}>{fmtIls(s.show_price)}</td>
                                {/* מקדמה */}
                                <td style={{ padding: "12px 14px", color: TEXT2, whiteSpace: "nowrap" }}>{fmtIls(s.advance_payment)}</td>
                                {/* יתרה */}
                                <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                                  <span style={{ color: calcRemaining(s) > 0 ? BRAND : GREEN, fontWeight: 700 }}>{fmtIls(calcRemaining(s))}</span>
                                </td>
                                {/* רווח לייבל */}
                                <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                                  <span style={{ color: GREEN, fontWeight: 700 }}>{fmtIls(calcLabelShare(s))}</span>
                                </td>
                                {/* פעולות */}
                                <td style={{ padding: "12px 14px" }}>
                                  <button
                                    onClick={e => { e.stopPropagation(); setSelected(prev => prev?.id === s.id ? null : s); }}
                                    style={{
                                      background: CARD2, border: `1px solid ${BDR2}`,
                                      borderRadius: 7, padding: "5px 10px", fontSize: 11,
                                      color: TEXT2, cursor: "pointer", transition: "none",
                                    }}
                                  >פרטים</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── Side panel ──────────────────────────────────────────────────── */}
          {selected && (
            <ShowPanel show={selected} onClose={() => setSelected(null)} />
          )}
        </div>
      </div>
    </div>
  );
}
