"use client";

/**
 * "קידום ותקציב" — campaign promotion/budget section, shown inside the campaign
 * page between the content board and the media gallery. Same visual language as
 * SocialDesignPreview (tokens replicated inline — no shared theme file).
 *
 * Money model (see lib/social-promotions-store.ts): planned_amount lives here;
 * the actual spend is a real Finance transaction. actual_amount is DERIVED from
 * that transaction by the API — this component never stores a parallel amount.
 */

import { useState, useEffect, useCallback, type CSSProperties } from "react";

// ── Tokens (matched to SocialDesignPreview) ─────────────────────────────────────
const BRAND = "#DC2626";
const GREEN = "#10B981";
const AMBER = "#F59E0B";
const BLUE  = "#3B82F6";
const CARD  = "rgba(255,255,255,0.058)";
const CARD2 = "rgba(255,255,255,0.085)";
const BDR   = "rgba(255,255,255,0.10)";
const BDR2  = "rgba(255,255,255,0.18)";
const TEXT  = "#F2F2F2";
const TEXT2 = "#A0A0B0";
const MUTED = "#52526A";
const LABEL = "#70709A";

const CHANNELS = ["YouTube", "TikTok", "Instagram", "אחר"];
const TYPES    = ["קידום ממומן", "רקדן / יוצר תוכן", "משפיען", "עמוד תוכן", "אחר"];
const STATUSES = ["מתוכנן", "פעיל", "בוצע", "בוטל"];
const STATUS_COLOR: Record<string, string> = {
  "מתוכנן": AMBER, "פעיל": BLUE, "בוצע": GREEN, "בוטל": MUTED,
};

interface Promotion {
  id: string;
  campaign_id: string;
  channel: string;
  promo_type: string;
  name: string;
  planned_amount: number;
  status: string;
  promo_date: string | null;
  notes: string;
  linked_transaction_id: string | null;
  actual_amount: number;
}

function fmtMoney(n: number): string {
  return `₪${(Number(n) || 0).toLocaleString("he-IL")}`;
}
function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${parseInt(day, 10)}.${parseInt(m, 10)}.${y.slice(2)}`;
}

function StatusPill({ status }: { status: string }) {
  const c = STATUS_COLOR[status] ?? MUTED;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
      background: `${c}2C`, border: `1px solid ${c}70`, color: c,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c, flexShrink: 0 }} />
      {status}
    </span>
  );
}

const MINPUT: CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 9, fontSize: 13,
  background: "rgba(255,255,255,0.085)", border: `1px solid ${BDR2}`,
  color: TEXT, outline: "none", boxSizing: "border-box",
  fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl",
};
const LABEL_S: CSSProperties = { fontSize: 11, fontWeight: 700, color: LABEL, marginBottom: 6, display: "block" };

// ── Add / Edit modal ─────────────────────────────────────────────────────────
function PromotionModal({ campaignId, item, onClose, onSaved }: {
  campaignId: string;
  item: Promotion | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isEdit = !!item;
  const [name, setName]           = useState(item?.name ?? "");
  const [channel, setChannel]     = useState(item?.channel ?? CHANNELS[0]);
  const [promoType, setPromoType] = useState(item?.promo_type ?? TYPES[0]);
  const [planned, setPlanned]     = useState(item ? String(item.planned_amount) : "");
  const [actual, setActual]       = useState(item ? String(item.actual_amount) : "");
  const [status, setStatus]       = useState(item?.status ?? STATUSES[0]);
  const [promoDate, setPromoDate] = useState(item?.promo_date ?? "");
  const [notes, setNotes]         = useState(item?.notes ?? "");
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState("");

  const canSave = name.trim().length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true); setErr("");
    try {
      const payload = {
        campaignId,
        channel, promo_type: promoType, name: name.trim(),
        planned_amount: Math.max(0, Number(planned) || 0),
        actual: Math.max(0, Number(actual) || 0),
        status, promo_date: promoDate || null, notes: notes.trim(),
      };
      const url = isEdit ? `/api/social/promotions/${item!.id}` : "/api/social/promotions";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "השמירה נכשלה"); }
      await onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה"); setSaving(false);
    }
  }

  return (
    <div
      onClick={() => { if (!saving) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.78)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: "#0D0D16", border: `1px solid ${BDR2}`, borderRadius: 18, padding: "26px 26px 22px", width: "min(480px, 94vw)", maxHeight: "90vh", overflowY: "auto", direction: "rtl" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: TEXT }}>{isEdit ? "עריכת פעולת קידום" : "פעולת קידום חדשה"}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: MUTED, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {err && (
          <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, color: "#F87171", marginBottom: 14 }}>{err}</div>
        )}

        <div style={{ marginBottom: 13 }}>
          <label style={LABEL_S}>שם / יעד *</label>
          <input style={MINPUT} value={name} onChange={e => setName(e.target.value)} placeholder="לדוגמה: YouTube Ads — פרנציפ" disabled={saving} />
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 13 }}>
          <div style={{ flex: 1 }}>
            <label style={LABEL_S}>ערוץ</label>
            <select style={{ ...MINPUT, cursor: "pointer" }} value={channel} onChange={e => setChannel(e.target.value)} disabled={saving}>
              {CHANNELS.map(c => <option key={c} value={c} style={{ background: "#15151F" }}>{c}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={LABEL_S}>סוג קידום</label>
            <select style={{ ...MINPUT, cursor: "pointer" }} value={promoType} onChange={e => setPromoType(e.target.value)} disabled={saving}>
              {TYPES.map(t => <option key={t} value={t} style={{ background: "#15151F" }}>{t}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 13 }}>
          <div style={{ flex: 1 }}>
            <label style={LABEL_S}>תקציב מתוכנן (₪)</label>
            <input type="number" inputMode="decimal" min={0} step="1" style={{ ...MINPUT, direction: "ltr", textAlign: "right" }} value={planned} onChange={e => setPlanned(e.target.value)} placeholder="0" disabled={saving} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={LABEL_S}>הוצאה בפועל (₪)</label>
            <input type="number" inputMode="decimal" min={0} step="1" style={{ ...MINPUT, direction: "ltr", textAlign: "right" }} value={actual} onChange={e => setActual(e.target.value)} placeholder="0" disabled={saving} />
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: MUTED, marginTop: -6, marginBottom: 13 }}>
          הוצאה בפועל &gt; 0 יוצרת/מעדכנת הוצאה אחת ב-Finance (שיווק · שולם).
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 13 }}>
          <div style={{ flex: 1 }}>
            <label style={LABEL_S}>סטטוס</label>
            <select style={{ ...MINPUT, cursor: "pointer" }} value={status} onChange={e => setStatus(e.target.value)} disabled={saving}>
              {STATUSES.map(s => <option key={s} value={s} style={{ background: "#15151F" }}>{s}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={LABEL_S}>תאריך</label>
            <input type="date" style={{ ...MINPUT, direction: "ltr", textAlign: "right", colorScheme: "dark" }} value={promoDate} onChange={e => setPromoDate(e.target.value)} disabled={saving} />
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={LABEL_S}>הערות</label>
          <textarea style={{ ...MINPUT, resize: "vertical", minHeight: 54 }} value={notes} onChange={e => setNotes(e.target.value)} disabled={saving} />
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={saving} style={{ padding: "9px 18px", borderRadius: 9, background: "none", border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
          <button onClick={save} disabled={!canSave} style={{ padding: "9px 22px", borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: canSave ? "pointer" : "default", fontFamily: "inherit", color: "#fff", border: "none", background: BRAND, opacity: canSave ? 1 : 0.55, boxShadow: "0 2px 12px rgba(220,38,38,0.35)" }}>
            {saving ? "שומר…" : isEdit ? "שמור" : "הוסף"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete confirm ────────────────────────────────────────────────────────────
function DeleteConfirm({ item, onConfirm, onCancel }: { item: Promotion; onConfirm: () => void; onCancel: () => void }) {
  const [deleting, setDeleting] = useState(false);
  return (
    <div onClick={() => { if (!deleting) onCancel(); }} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0D0D16", border: `1px solid ${BDR2}`, borderRadius: 14, padding: 24, width: "min(380px, 92vw)", direction: "rtl" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, marginBottom: 10 }}>למחוק פעולת קידום?</div>
        <div style={{ fontSize: 13, color: TEXT2, marginBottom: 6, lineHeight: 1.6 }}>
          &ldquo;{item.name}&rdquo; תימחק מרשימת הקידום.
        </div>
        {item.linked_transaction_id && (
          <div style={{ fontSize: 12, color: AMBER, marginBottom: 20, lineHeight: 1.6 }}>
            ההוצאה המקושרת ב-Finance ({fmtMoney(item.actual_amount)}) <b>תישאר</b> — היא לא נמחקת.
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: item.linked_transaction_id ? 0 : 14 }}>
          <button onClick={onCancel} disabled={deleting} style={{ padding: "8px 16px", borderRadius: 8, background: "none", border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
          <button onClick={() => { setDeleting(true); onConfirm(); }} disabled={deleting} style={{ padding: "8px 20px", borderRadius: 8, background: BRAND, border: "none", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: deleting ? 0.7 : 1 }}>
            {deleting ? "מוחק…" : "מחק"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main section ──────────────────────────────────────────────────────────────
export default function SocialPromotions({ campaignId }: { campaignId: string }) {
  const [items, setItems]     = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [modal, setModal]     = useState<Promotion | "new" | null>(null);
  const [delItem, setDelItem] = useState<Promotion | null>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/social/promotions?campaignId=${campaignId}`);
      const d = await res.json().catch(() => ({}));
      setItems(Array.isArray(d.promotions) ? d.promotions : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/social/promotions/${id}`, { method: "DELETE" });
      await load();
    } finally { setDelItem(null); }
  }

  // ── Summary ── plannedTotal excludes cancelled; actualTotal from linked txs ──
  const plannedTotal = items.filter(i => i.status !== "בוטל").reduce((s, i) => s + (Number(i.planned_amount) || 0), 0);
  const actualTotal  = items.reduce((s, i) => s + (Number(i.actual_amount) || 0), 0);
  const remaining    = plannedTotal - actualTotal;
  const overage      = actualTotal > plannedTotal;

  const COL = "1.7fr 1fr 1fr 1fr 0.9fr 96px";

  const addBtn = (
    <button
      onClick={() => setModal("new")}
      style={{ fontSize: 12, fontWeight: 800, padding: "8px 18px", borderRadius: 8, background: BRAND, border: "none", color: "#fff", cursor: "pointer", boxShadow: "0 2px 12px rgba(220,38,38,0.4)" }}
    >+ הוסף קידום</button>
  );

  return (
    <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, padding: 0, overflow: "hidden", marginBottom: 12, boxShadow: "0 2px 18px rgba(0,0,0,0.4)" }}>
      {/* Header */}
      <div style={{ padding: "16px 22px 14px", borderBottom: `1px solid ${BDR}`, background: "rgba(255,255,255,0.03)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 900, color: TEXT }}>📣 קידום ותקציב</span>
            {!loading && (
              <span style={{ background: CARD2, border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6 }}>{items.length}</span>
            )}
          </div>
          {addBtn}
        </div>

        {/* Compact summary */}
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          {[
            { lbl: "תקציב מתוכנן", val: fmtMoney(plannedTotal), c: AMBER },
            { lbl: "הוצאה בפועל",  val: fmtMoney(actualTotal),  c: BLUE  },
            overage
              ? { lbl: "חריגה", val: fmtMoney(actualTotal - plannedTotal), c: BRAND }
              : { lbl: "נותר",  val: fmtMoney(remaining),               c: GREEN },
          ].map(s => (
            <div key={s.lbl} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 14px", borderRadius: 10, background: CARD2, border: `1px solid ${BDR}` }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.c, flexShrink: 0 }} />
              <span style={{ fontSize: 15, fontWeight: 900, color: TEXT, lineHeight: 1 }}>{s.val}</span>
              <span style={{ fontSize: 11.5, color: TEXT2, fontWeight: 600, whiteSpace: "nowrap" }}>{s.lbl}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ padding: "34px 0", textAlign: "center", color: MUTED, fontSize: 13 }}>טוען…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: "11px 22px 13px", fontSize: 12.5, color: MUTED }}>
          אין עדיין פעולות קידום — לחץ &ldquo;+ הוסף קידום&rdquo; כדי להתחיל.
        </div>
      ) : isMobile ? (
        /* Mobile cards */
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px" }}>
          {items.map(it => (
            <div key={it.id} style={{ background: CARD2, border: `1px solid ${BDR}`, borderRadius: 12, padding: "13px 14px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>{it.name}</div>
                  <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{it.channel} · {it.promo_type}</div>
                </div>
                <StatusPill status={it.status} />
              </div>
              <div style={{ display: "flex", gap: 14, fontSize: 12, color: TEXT2, marginBottom: 10, flexWrap: "wrap" }}>
                <span>מתוכנן: <b style={{ color: TEXT }}>{fmtMoney(it.planned_amount)}</b></span>
                <span>בפועל: <b style={{ color: it.actual_amount > 0 ? GREEN : TEXT2 }}>{fmtMoney(it.actual_amount)}</b></span>
                {it.promo_date && <span>📅 {fmtDate(it.promo_date)}</span>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setModal(it)} style={{ flex: 1, padding: "7px 0", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}`, color: TEXT2, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>עריכה</button>
                <button onClick={() => setDelItem(it)} style={{ padding: "7px 14px", borderRadius: 8, background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.28)", color: "rgba(220,38,38,0.7)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>מחק</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Desktop table */
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: COL, padding: "11px 22px", borderBottom: `1px solid ${BDR2}`, background: "rgba(255,255,255,0.04)", fontSize: 10, fontWeight: 800, color: TEXT2, textTransform: "uppercase", letterSpacing: "0.06em", alignItems: "center" }}>
            <div>שם / יעד</div>
            <div style={{ textAlign: "center" }}>מתוכנן</div>
            <div style={{ textAlign: "center" }}>בפועל</div>
            <div style={{ textAlign: "center" }}>סטטוס</div>
            <div style={{ textAlign: "center" }}>תאריך</div>
            <div style={{ textAlign: "center" }}>פעולות</div>
          </div>
          {items.map((it, idx) => (
            <div key={it.id} style={{ display: "grid", gridTemplateColumns: COL, padding: "13px 22px", borderBottom: idx < items.length - 1 ? `1px solid ${BDR}` : "none", fontSize: 13, color: TEXT2, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.channel} · {it.promo_type}</div>
              </div>
              <div style={{ textAlign: "center", color: TEXT }}>{fmtMoney(it.planned_amount)}</div>
              <div style={{ textAlign: "center", color: it.actual_amount > 0 ? GREEN : MUTED, fontWeight: it.actual_amount > 0 ? 700 : 400 }}>{fmtMoney(it.actual_amount)}</div>
              <div style={{ display: "flex", justifyContent: "center" }}><StatusPill status={it.status} /></div>
              <div style={{ textAlign: "center", color: TEXT2, fontSize: 12, direction: "ltr" }}>{fmtDate(it.promo_date)}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <button onClick={() => setModal(it)} title="עריכה" style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}`, color: TEXT2, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>עריכה</button>
                <button onClick={() => setDelItem(it)} title="מחק" style={{ width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.28)", color: "rgba(220,38,38,0.6)", cursor: "pointer", fontSize: 13 }}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <PromotionModal
          campaignId={campaignId}
          item={modal === "new" ? null : modal}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
      {delItem && (
        <DeleteConfirm item={delItem} onConfirm={() => handleDelete(delItem.id)} onCancel={() => setDelItem(null)} />
      )}
    </div>
  );
}
