"use client";

import { useEffect, useMemo, useState } from "react";
import type { Show, ShowStatus, PaymentStatus } from "@/lib/shows-types";
import { SHOW_STATUSES, PAYMENT_STATUSES } from "@/lib/shows-types";

// ─── Design tokens ─────────────────────────────────────────────────────────
const BG    = "#080808";
const BG2   = "#101010";
const CARD  = "rgba(255,255,255,0.032)";
const CARD2 = "rgba(255,255,255,0.07)";
const BDR   = "rgba(255,255,255,0.08)";
const BDR2  = "rgba(255,255,255,0.15)";
const TEXT  = "#F2F2F2";
const TEXT2 = "#A0A0B0";
const MUTED = "#52526A";
const BRAND = "#DC2626";
const GREEN = "#10B981";
const AMBER = "#F59E0B";
const BLUE  = "#3B82F6";
const PURPLE = "#8B5CF6";

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

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtIls(n: number) { return `₪${n.toLocaleString("he-IL")}`; }

const MONTHS = ["","ינו","פבר","מרץ","אפר","מאי","יוני","יולי","אוג","ספט","אוק","נוב","דצ"];
const DAYS   = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [, m, day] = d.split("-");
  return `${parseInt(day, 10)} ${MONTHS[parseInt(m, 10)]}`;
}
function fmtDay(d: string | null): string {
  if (!d) return "—";
  return DAYS[new Date(d).getDay()];
}
function isUpcoming(d: string | null): boolean {
  if (!d) return false;
  return new Date(d) >= new Date(new Date().toDateString());
}
function calcDistributable(s: Show) { return Math.max(0, s.show_price - s.dj_fee); }
function calcLabelShare(s: Show)    { return calcDistributable(s) / 2; }
function calcArtistShare(s: Show)   { return calcDistributable(s) / 2; }
function calcRemaining(s: Show)     { return Math.max(0, s.show_price - s.advance_payment); }

// ─── Badge ──────────────────────────────────────────────────────────────────
function Badge({ bg, text, children }: { bg: string; text: string; children: React.ReactNode }) {
  return (
    <span style={{
      background: bg, color: text, borderRadius: 100,
      padding: "3px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
      border: `1px solid ${text}28`,
    }}>{children}</span>
  );
}

// ─── Decorative gradients ────────────────────────────────────────────────────
const CARD_GRADS   = [
  "linear-gradient(145deg,#1f0707 0%,#2d0a0a 60%,#0d0d0d 100%)",
  "linear-gradient(145deg,#060d1f 0%,#0d1a2d 60%,#0d0d0d 100%)",
  "linear-gradient(145deg,#091a09 0%,#0d2d0d 60%,#0d0d0d 100%)",
  "linear-gradient(145deg,#1a060c 0%,#2d0d12 60%,#0d0d0d 100%)",
  "linear-gradient(145deg,#0a0915 0%,#150d2d 60%,#0d0d0d 100%)",
];
const CARD_ACCENTS = [BRAND, BLUE, GREEN, "#E879F9", AMBER];

// ─── Show Card ───────────────────────────────────────────────────────────────
function ShowCard({ show, accent, grad, onClick, selected }: {
  show: Show; accent: string; grad: string;
  onClick: () => void; selected: boolean;
}) {
  const artistShare = calcArtistShare(show);
  const labelShare  = calcLabelShare(show);
  return (
    <div onClick={onClick} style={{
      width: "100%",
      borderRadius: 18,
      background: grad,
      border: `1.5px solid ${selected ? accent : BDR}`,
      boxShadow: selected
        ? `0 0 0 2px ${accent}40, 0 12px 36px rgba(0,0,0,0.6)`
        : "0 6px 24px rgba(0,0,0,0.5)",
      cursor: "pointer", overflow: "hidden",
      display: "flex", flexDirection: "column",
    }}>
      {/* Cover */}
      <div style={{ height: 140, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 50% 65%, ${accent}30 0%, transparent 68%)` }} />
        {/* Crowd silhouette */}
        <svg viewBox="0 0 420 70" style={{ position: "absolute", bottom: 0, width: "100%", opacity: 0.12 }} preserveAspectRatio="none">
          {Array.from({ length: 20 }).map((_, i) => (
            <ellipse key={i} cx={i * 22 + 11} cy={70} rx={7 + (i % 3) * 2} ry={12 + (i % 5) * 6} fill={accent} />
          ))}
        </svg>
        {/* Date badge */}
        <div style={{ position: "absolute", top: 12, right: 12, background: accent, borderRadius: 12, padding: "5px 12px", textAlign: "center", minWidth: 46 }}>
          {show.date ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{parseInt(show.date.split("-")[2], 10)}</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.85)", letterSpacing: "0.04em" }}>{MONTHS[parseInt(show.date.split("-")[1], 10)]}</div>
            </>
          ) : <div style={{ fontSize: 11, color: "#fff" }}>—</div>}
        </div>
        {show.date && (
          <div style={{ position: "absolute", bottom: 10, right: 14, fontSize: 11, color: `${accent}CC`, fontWeight: 700 }}>
            {fmtDay(show.date)}{show.start_time ? ` · ${show.start_time}` : ""}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "14px 16px 16px", flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, lineHeight: 1.2 }}>{show.name}</div>
        <div style={{ fontSize: 12, color: TEXT2, fontWeight: 600 }}>{show.artist || "—"}</div>
        <div style={{ fontSize: 11, color: MUTED }}>{show.location || "—"}</div>
        <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
          <Badge bg={STATUS_COLOR[show.status].bg} text={STATUS_COLOR[show.status].text}>{show.status}</Badge>
          <Badge bg={PAY_COLOR[show.payment_status].bg} text={PAY_COLOR[show.payment_status].text}>{show.payment_status}</Badge>
        </div>
        {/* Finance strip */}
        <div style={{ display: "flex", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BDR}` }}>
          {[
            { label: "מחיר",  val: fmtIls(show.show_price), color: TEXT },
            { label: "אמן",   val: fmtIls(artistShare),     color: AMBER },
            { label: "לייבל", val: fmtIls(labelShare),      color: GREEN },
          ].map((item, idx) => (
            <div key={idx} style={{ flex: 1, textAlign: "center", borderRight: idx < 2 ? `1px solid ${BDR}` : undefined }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: item.color }}>{item.val}</div>
              <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, icon }: {
  label: string; value: string | number; sub: string; color: string; icon: string;
}) {
  return (
    <div style={{
      background: `${color}08`,
      border: `1px solid ${color}22`,
      borderTop: `3px solid ${color}`,
      borderRadius: 16,
      padding: "18px 20px",
      position: "relative", overflow: "hidden",
      minHeight: 110,
      display: "flex", flexDirection: "column", justifyContent: "space-between",
    }}>
      {/* Ghost icon */}
      <div style={{ position: "absolute", bottom: -10, left: -6, fontSize: 64, opacity: 0.05, userSelect: "none", lineHeight: 1 }}>{icon}</div>
      {/* Top */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: TEXT2, textTransform: "uppercase", letterSpacing: "0.1em", lineHeight: 1.3 }}>{label}</div>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: `${color}15`, border: `1px solid ${color}28`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{icon}</div>
      </div>
      {/* Value */}
      <div>
        <div style={{ fontSize: 34, fontWeight: 900, color, lineHeight: 1, marginBottom: 4 }}>{value}</div>
        <div style={{ fontSize: 11, color: `${color}70` }}>{sub}</div>
      </div>
    </div>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────
function SectionHeader({ title, count, color = BLUE }: { title: string; count?: number; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
      <div style={{ width: 4, height: 18, borderRadius: 2, background: color, flexShrink: 0 }} />
      <div style={{ fontSize: 16, fontWeight: 800, color: TEXT }}>{title}</div>
      {count !== undefined && (
        <div style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${color}15`, border: `1px solid ${color}28`, color }}>{count}</div>
      )}
    </div>
  );
}

// ─── Show Panel (fixed overlay) ──────────────────────────────────────────────
function ShowPanel({ show, onClose }: { show: Show; onClose: () => void }) {
  const distributable = calcDistributable(show);
  const artist        = calcArtistShare(show);
  const label         = calcLabelShare(show);
  const remaining     = calcRemaining(show);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.5)" }} />
      <div style={{
        position: "fixed", top: 60, bottom: 0, left: 0, zIndex: 201,
        width: 400, maxWidth: "92vw",
        background: "#0E0E0E",
        borderRight: `1px solid ${BDR2}`,
        borderTop: `1px solid ${BDR2}`,
        display: "flex", flexDirection: "column",
        boxShadow: "4px 0 40px rgba(0,0,0,0.8)",
        overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 22px 16px", borderBottom: `1px solid ${BDR}`, position: "sticky", top: 0, background: "#0E0E0E", zIndex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, marginBottom: 3 }}>{show.name}</div>
              <div style={{ fontSize: 12, color: TEXT2 }}>{show.artist || "—"}</div>
            </div>
            <button onClick={onClose} style={{ background: CARD2, border: `1px solid ${BDR}`, cursor: "pointer", color: TEXT2, fontSize: 14, padding: "6px 10px", borderRadius: 8, lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            <Badge bg={STATUS_COLOR[show.status].bg} text={STATUS_COLOR[show.status].text}>{show.status}</Badge>
            <Badge bg={PAY_COLOR[show.payment_status].bg} text={PAY_COLOR[show.payment_status].text}>{show.payment_status}</Badge>
            {show.calendar_event_id && <Badge bg="rgba(59,130,246,0.18)" text={BLUE}>📅 ביומן</Badge>}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "18px 22px", flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Info */}
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {([
              { label: "תאריך",   value: show.date ? `${fmtDate(show.date)} · ${fmtDay(show.date)}` : "—" },
              { label: "שעה",     value: show.start_time || "—" },
              { label: "מיקום",  value: show.location || "—" },
              show.contact_person ? { label: "איש קשר", value: show.contact_person } : null,
              show.phone          ? { label: "טלפון",   value: show.phone }          : null,
              show.booker_name    ? { label: "מזמין",   value: show.booker_name }    : null,
            ] as ({ label: string; value: string } | null)[]).filter(Boolean).map(r => (
              <div key={r!.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: MUTED }}>{r!.label}</span>
                <span style={{ color: TEXT, fontWeight: 600 }}>{r!.value}</span>
              </div>
            ))}
          </div>

          {/* Finance */}
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>כספים</div>
            {[
              { label: "מחיר הופעה",      value: fmtIls(show.show_price),    color: TEXT },
              { label: "DJ fee",           value: `−${fmtIls(show.dj_fee)}`,  color: MUTED },
              { label: "יתרה לחלוקה",     value: fmtIls(distributable),       color: AMBER, bold: true },
              { label: "חלק אמן (50%)",   value: fmtIls(artist),             color: BLUE },
              { label: "חלק לייבל (50%)", value: fmtIls(label),              color: GREEN },
              { label: "מקדמה ששולמה",    value: fmtIls(show.advance_payment),color: TEXT2 },
              { label: "יתרה לגבייה",     value: fmtIls(remaining),           color: remaining > 0 ? BRAND : GREEN, bold: true },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 9 }}>
                <span style={{ color: MUTED }}>{r.label}</span>
                <span style={{ color: r.color, fontWeight: r.bold ? 800 : 600 }}>{r.value}</span>
              </div>
            ))}
          </div>

          {show.notes && (
            <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>הערות</div>
              <div style={{ fontSize: 13, color: TEXT2, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{show.notes}</div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
            {[{ label: "✏️ עריכה" }, { label: "📅 הוסף ליומן" }].map(b => (
              <button key={b.label} disabled style={{
                flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700,
                background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}`,
                color: MUTED, cursor: "not-allowed",
              }}>{b.label}</button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function ShowsHubPreview() {
  const [shows,     setShows]     = useState<Show[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [search,    setSearch]    = useState("");
  const [filterSt,  setFilterSt]  = useState<ShowStatus | "">("");
  const [filterPay, setFilterPay] = useState<PaymentStatus | "">("");
  const [selected,  setSelected]  = useState<Show | null>(null);

  useEffect(() => {
    fetch("/api/shows")
      .then(r => r.json())
      .then(d => { setShows(Array.isArray(d.shows) ? d.shows : []); setLoading(false); })
      .catch(() => { setError("לא הצלחנו לטעון הופעות"); setLoading(false); });
  }, []);

  const upcoming = useMemo(() =>
    [...shows]
      .filter(s => isUpcoming(s.date) && s.status !== "בוטל")
      .sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9"))
      .slice(0, 4),
    [shows]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return shows.filter(s => {
      if (filterSt  && s.status         !== filterSt)  return false;
      if (filterPay && s.payment_status !== filterPay) return false;
      if (q && !`${s.name} ${s.artist} ${s.location} ${s.booker_name ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [shows, search, filterSt, filterPay]);

  const kpis = useMemo(() => {
    const active = shows.filter(s => s.status !== "בוטל");
    return {
      total:       shows.length,
      upCount:     upcoming.length,
      expIncome:   active.reduce((a, s) => a + s.show_price, 0),
      remaining:   active.reduce((a, s) => a + calcRemaining(s), 0),
      labelProfit: active.reduce((a, s) => a + calcLabelShare(s), 0),
    };
  }, [shows, upcoming]);

  const selectStyle: React.CSSProperties = {
    background: BG2, border: `1px solid ${BDR2}`, color: TEXT2,
    borderRadius: 9, padding: "8px 12px", fontSize: 12, fontFamily: "inherit",
    outline: "none", direction: "rtl",
  };

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl" }}>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <div style={{
        position: "relative", overflow: "hidden",
        background: "linear-gradient(180deg,#1a0505 0%,#0f0404 50%,#080808 100%)",
        borderBottom: `1px solid rgba(220,38,38,0.20)`,
      }}>
        {/* Glow orbs */}
        <div style={{ position: "absolute", top: -40, right: "20%", width: 360, height: 220, background: "radial-gradient(ellipse,rgba(220,38,38,0.12) 0%,transparent 70%)", pointerEvents: "none" }} />
        {/* Crowd silhouette */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 44, opacity: 0.055, pointerEvents: "none" }}>
          <svg viewBox="0 0 1400 44" style={{ width: "100%", height: "100%" }} preserveAspectRatio="none">
            {Array.from({ length: 64 }).map((_, i) => (
              <ellipse key={i} cx={i * 22 + 11} cy={44} rx={6 + (i % 3) * 2} ry={9 + (i % 5) * 4} fill={BRAND} />
            ))}
          </svg>
        </div>

        {/* Content aligned to same container as body */}
        <div style={{ maxWidth: 1680, marginInline: "auto", padding: "22px 28px 20px", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
            {/* Title block */}
            <div>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                background: "rgba(220,38,38,0.10)", border: "1px solid rgba(220,38,38,0.28)",
                borderRadius: 100, padding: "2px 12px", fontSize: 9, fontWeight: 700,
                color: "#F87171", letterSpacing: "0.08em", marginBottom: 8, width: "fit-content",
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#F87171", display: "inline-block" }} />
                PREVIEW / עיצוב בלבד
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 36, fontWeight: 900, color: TEXT, letterSpacing: "-0.02em", lineHeight: 1 }}>הופעות הלייבל</div>
                <span style={{ fontSize: 26 }}>🎤</span>
              </div>
              <div style={{ fontSize: 13, color: TEXT2, marginTop: 6 }}>
                ניהול כל ההופעות — תאריכים, סטטוסים, הזמנות ותשלומים.
              </div>
            </div>
            {/* Button */}
            <button style={{
              display: "flex", alignItems: "center", gap: 7,
              background: BRAND, border: "none", borderRadius: 12,
              padding: "11px 22px", fontSize: 14, fontWeight: 700,
              color: "#fff", cursor: "default",
              boxShadow: "0 4px 20px rgba(220,38,38,0.40)",
              flexShrink: 0, transition: "none",
            }} title="Visual only — read-only preview">
              <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> הופעה חדשה
            </button>
          </div>
        </div>
      </div>

      {/* ── Page body — constrained container ──────────────────────────────── */}
      <div style={{ maxWidth: 1680, marginInline: "auto", padding: "24px 28px 64px" }}>

        {loading && (
          <div style={{ textAlign: "center", padding: "100px 0", color: TEXT2 }}>
            <div style={{ fontSize: 44, marginBottom: 14, opacity: 0.2 }}>🎤</div>
            <div style={{ fontSize: 14 }}>טוען הופעות…</div>
          </div>
        )}
        {error && (
          <div style={{ textAlign: "center", padding: "100px 0", color: "#EF4444" }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>⚠️</div>
            <div>{error}</div>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* ── KPI grid — auto-fill keeps cards proportional ───────────── */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 14,
              marginBottom: 28,
            }}>
              <KpiCard label="סה״כ הופעות"    value={kpis.total}               sub="הופעות רשומות"      color={BRAND}  icon="🎤" />
              <KpiCard label="הופעות קרובות"   value={kpis.upCount}             sub="ב-30 הימים הקרובים" color={BLUE}   icon="📅" />
              <KpiCard label="הכנסות צפויות"   value={fmtIls(kpis.expIncome)}   sub="מהופעות פעילות"     color={GREEN}  icon="💰" />
              <KpiCard label="יתרה לגבייה"     value={fmtIls(kpis.remaining)}   sub="טרם שולם"           color={AMBER}  icon="⏳" />
              <KpiCard label="רווח לייבל צפוי" value={fmtIls(kpis.labelProfit)} sub="50% מיתרה לחלוקה"  color={PURPLE} icon="🏷️" />
            </div>

            {/* ── Two-column main area ────────────────────────────────────── */}
            {/* RTL flex: first item = right side (upcoming), second = left (table) */}
            <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>

              {/* ── RIGHT COLUMN: Upcoming shows (fixed width) ─────────────── */}
              {upcoming.length > 0 && (
                <div style={{ flex: "0 0 380px", maxWidth: 420, minWidth: 300 }}>
                  <SectionHeader title="הופעות קרובות" count={upcoming.length} color={BLUE} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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

              {/* ── LEFT COLUMN: All shows table ───────────────────────────── */}
              <div style={{ flex: "1 1 500px", minWidth: 0 }}>
                <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, overflow: "hidden" }}>
                  {/* Table toolbar */}
                  <div style={{
                    padding: "18px 20px 16px", borderBottom: `1px solid ${BDR}`,
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    flexWrap: "wrap", gap: 12,
                  }}>
                    <SectionHeader title="כל ההופעות" count={filtered.length} color={BRAND} />
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {/* Search */}
                      <div style={{ position: "relative" }}>
                        <input
                          value={search}
                          onChange={e => setSearch(e.target.value)}
                          placeholder="חיפוש..."
                          style={{
                            ...selectStyle,
                            paddingRight: 30, width: 180,
                            background: BG2, border: `1px solid ${BDR2}`, color: TEXT,
                          }}
                        />
                        <span style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 12, pointerEvents: "none" }}>🔍</span>
                      </div>
                      <select value={filterSt}  onChange={e => setFilterSt(e.target.value as ShowStatus | "")}    style={selectStyle}>
                        <option value="">כל הסטטוסים</option>
                        {SHOW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <select value={filterPay} onChange={e => setFilterPay(e.target.value as PaymentStatus | "")} style={selectStyle}>
                        <option value="">כל התשלומים</option>
                        {PAYMENT_STATUSES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Table */}
                  {filtered.length === 0 ? (
                    <div style={{ padding: "56px 0", textAlign: "center", color: MUTED }}>
                      <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.2 }}>🎤</div>
                      <div style={{ fontSize: 13 }}>אין הופעות להצגה</div>
                    </div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${BDR}`, background: "rgba(255,255,255,0.016)" }}>
                            {["הופעה","תאריך","מיקום","סטטוס","תשלום","מחיר","מקדמה","יתרה","לייבל",""].map(h => (
                              <th key={h} style={{
                                padding: "12px 16px", textAlign: "right",
                                fontSize: 10, fontWeight: 700, color: MUTED,
                                textTransform: "uppercase", letterSpacing: "0.08em",
                                whiteSpace: "nowrap",
                              }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((s, i) => {
                            const sel = selected?.id === s.id;
                            return (
                              <tr
                                key={s.id}
                                onClick={() => setSelected(prev => prev?.id === s.id ? null : s)}
                                style={{
                                  borderBottom: `1px solid ${BDR}`,
                                  background: sel
                                    ? "rgba(220,38,38,0.06)"
                                    : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.014)",
                                  cursor: "pointer",
                                  outline: sel ? `1px solid rgba(220,38,38,0.24)` : "none",
                                  outlineOffset: -1,
                                }}
                              >
                                <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                                  <div style={{ fontWeight: 700, color: TEXT }}>{s.name}</div>
                                  {s.artist && <div style={{ fontSize: 11, color: TEXT2, marginTop: 2 }}>{s.artist}</div>}
                                </td>
                                <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                                  {s.date ? (
                                    <>
                                      <div style={{ fontWeight: 600, color: TEXT }}>{fmtDate(s.date)}</div>
                                      <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{fmtDay(s.date)}{s.start_time ? ` · ${s.start_time}` : ""}</div>
                                    </>
                                  ) : <span style={{ color: MUTED }}>—</span>}
                                </td>
                                <td style={{ padding: "14px 16px", color: TEXT2, whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {s.location || <span style={{ color: MUTED }}>—</span>}
                                </td>
                                <td style={{ padding: "14px 16px" }}>
                                  <Badge bg={STATUS_COLOR[s.status].bg} text={STATUS_COLOR[s.status].text}>{s.status}</Badge>
                                </td>
                                <td style={{ padding: "14px 16px" }}>
                                  <Badge bg={PAY_COLOR[s.payment_status].bg} text={PAY_COLOR[s.payment_status].text}>{s.payment_status}</Badge>
                                </td>
                                <td style={{ padding: "14px 16px", color: TEXT, fontWeight: 700, whiteSpace: "nowrap" }}>{fmtIls(s.show_price)}</td>
                                <td style={{ padding: "14px 16px", color: TEXT2, whiteSpace: "nowrap" }}>{fmtIls(s.advance_payment)}</td>
                                <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                                  <span style={{ color: calcRemaining(s) > 0 ? BRAND : GREEN, fontWeight: 700 }}>{fmtIls(calcRemaining(s))}</span>
                                </td>
                                <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                                  <span style={{ color: GREEN, fontWeight: 700 }}>{fmtIls(calcLabelShare(s))}</span>
                                </td>
                                <td style={{ padding: "14px 16px" }}>
                                  <button
                                    onClick={e => { e.stopPropagation(); setSelected(prev => prev?.id === s.id ? null : s); }}
                                    style={{
                                      background: sel ? `${BRAND}15` : CARD2,
                                      border: `1px solid ${sel ? BRAND + "38" : BDR2}`,
                                      borderRadius: 8, padding: "5px 12px", fontSize: 11,
                                      color: sel ? "#F87171" : TEXT2, cursor: "pointer",
                                      whiteSpace: "nowrap", fontWeight: 600,
                                    }}
                                  >{sel ? "סגור" : "פרטים"}</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

            </div>{/* end two-column */}
          </>
        )}
      </div>

      {/* ── Side panel overlay ─────────────────────────────────────────────── */}
      {selected && <ShowPanel show={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
