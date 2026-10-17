"use client";

/**
 * Social Hub — "סושיאל אמני הלייבל" (artist social stage 0 inside /social, Owner request 2026-10-17). OWNER-ONLY, READ-ONLY.
 * No logic of its own: one card per roster artist from the SAME `artist_social` answer Sunny gets (GET
 * /api/partner/knowledge — roster for the list, mode artist per card), and the full view is the existing ArtistSocialView.
 * The shared label channel stays apart (never inside an artist card). Writes nothing, sends nothing, browses nothing.
 */
import { useEffect, useState } from "react";
import ArtistContentSection from "./ArtistContentSection";
import ArtistCadenceSection, { PLATFORM_LABEL, type Cadence } from "./ArtistCadenceSection";
import { ArtistSocialView, PLATFORM_HE, fmt, heDate, metricName, nameOf, type ArtistSocialResp } from "@/components/label/ArtistSocialPanel";

const CARD = "rgba(255,255,255,0.058)";
const CARD2 = "rgba(255,255,255,0.085)";
const BDR = "rgba(255,255,255,0.10)";
const TEXT = "#F2F2F2";
const TEXT2 = "#A0A0B0";
const MUTED = "#6E6E86";
const GREEN = "#10B981";
const AMBER = "#F59E0B";
const RED = "#F87171";
const BLUE = "#60A5FA";

/** Display order the Owner asked for (fixed order, never a ranking); any other roster artist follows. */
const ORDER = ["נגש ביטס", "אבי מולה", "שליו טסמה"];

type GText = { text: string };
type Metric = { type: string; value: unknown; checkedOn: string; freshness: "TODAY" | "EARLIER"; change: { kind: string; delta?: number } | null; previous: { checkedOn: string } | null };
type Item = { id: string; entity: string | null; label: GText; fields: Record<string, unknown> };
type Resp = Omit<ArtistSocialResp, "items"> & { items: Item[] };
const api = (q: string) => fetch(`/api/partner/knowledge?capability=artist_social&${q}`, { cache: "no-store" }).then((r) => r.json() as Promise<Resp>);

export type Card = { key: string; name: string; data: Resp | null };

function headline(metrics: Metric[]): Metric | null {
  return metrics.find((m) => /\.(FOLLOWERS|SUBSCRIBERS)$/.test(m.type)) ?? metrics[0] ?? null;
}

function ArtistCard({ c, onOpen, onAdd }: { c: Card; onOpen: () => void; onAdd: () => void }) {
  const d = c.data;
  const unreadable = !d || d.status !== "OK" || d.completeness === "UNKNOWN";
  const accounts = d?.items.filter((i) => i.fields.kind === "ACCOUNT") ?? [];
  const records = d?.items.filter((i) => i.fields.recordType) ?? [];
  const insp = d?.items.filter((i) => i.fields.kind === "INSPIRATION").length ?? 0;
  const last = d?.summary.find((s) => s.code === "LAST_CHECKED_ON")?.value as string | null | undefined;
  const cad = d?.summary.find((s) => s.code === "CADENCE")?.value as Cadence | null | undefined;
  const content = d?.summary.find((s) => s.code === "CONTENT")?.value as { total: number; byPhase: Record<string, number>; overdue: unknown[]; upcoming: Array<{ title: string; publishDate: string }>; undated: number } | null | undefined;
  return (
    <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, padding: "15px 17px 14px", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 15.5, fontWeight: 800, color: TEXT }}>{c.name}</div>
        <div style={{ fontSize: 11, color: last ? AMBER : MUTED, whiteSpace: "nowrap" }}>{last ? `בדיקה אחרונה ${heDate(last)}` : "עוד לא נבדק"}</div>
      </div>
      {unreadable ? (
        <div style={{ fontSize: 12.5, color: AMBER }}>לא הצלחתי לקרוא את נתוני הסושיאל של {c.name} — זה לא אומר שאין נתונים.</div>
      ) : (
        <>
          <div style={{ display: "grid", gap: 7, marginBottom: 10 }}>
            {accounts.length ? accounts.map((a) => {
              const f = a.fields as { platform: string; ownership: { channelPurposeHe: string | null } | null; metrics: Metric[] };
              const m = headline(f.metrics);
              const delta = m?.change?.kind === "NUMBER" && typeof m.change.delta === "number" ? m.change.delta : null;
              return (
                <div key={a.id} style={{ background: CARD2, border: `1px solid ${BDR}`, borderRadius: 11, padding: "8px 10px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: TEXT, overflowWrap: "anywhere" }}>{nameOf(a.label.text, f.platform)}</span>
                    <span style={{ fontSize: 11, color: TEXT2 }}>{PLATFORM_HE[f.platform] ?? f.platform}</span>
                    {f.ownership?.channelPurposeHe && <span style={{ fontSize: 10.5, color: "#FF6B6B" }}>· {f.ownership.channelPurposeHe}</span>}
                  </div>
                  {m ? (
                    <div style={{ fontSize: 12, color: TEXT2, marginTop: 3 }}>
                      {metricName(m.type)}: <b style={{ color: TEXT }}>{fmt(m.value)}</b>
                      {delta !== null && m.previous && <> <bdi dir="ltr" style={{ color: delta > 0 ? GREEN : delta < 0 ? RED : TEXT2 }}>{delta > 0 ? "+" : ""}{delta.toLocaleString("he-IL")}</bdi></>}
                      <span style={{ color: m.freshness === "TODAY" ? GREEN : MUTED, marginInlineStart: 6 }}>({m.freshness === "TODAY" ? "היום" : heDate(m.checkedOn)})</span>
                    </div>
                  ) : <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>אין עדיין מדידה שמורה</div>}
                </div>
              );
            }) : <div style={{ fontSize: 12.5, color: TEXT2 }}>עוד לא אושר חשבון כשל {c.name}.</div>}
          </div>
          <div style={{ background: CARD2, border: `1px solid ${BDR}`, borderRadius: 11, padding: "8px 10px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: TEXT }}>תוכן</span>
              <button onClick={onAdd} style={{ background: "none", border: "none", color: "#FF6B6B", fontSize: 12, fontWeight: 800, cursor: "pointer", padding: 0 }}>+ תוכן חדש</button>
            </div>
            {content === undefined || content === null ? <div style={{ fontSize: 11.5, color: AMBER, marginTop: 3 }}>לא נקרא כרגע — זה לא אומר שאין תוכן</div>
              : content.total === 0 ? <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>עוד אין תוכן של האמן</div>
              : <div style={{ fontSize: 11.5, color: TEXT2, marginTop: 3, lineHeight: 1.6 }}>
                  רעיון {content.byPhase.IDEA ?? 0} · בעבודה {content.byPhase.WORK ?? 0} · מוכן {content.byPhase.READY ?? 0} · פורסם {content.byPhase.PUBLISHED ?? 0}
                  {content.overdue.length > 0 && <span style={{ color: RED }}> · עבר תאריך {content.overdue.length}</span>}
                  {content.upcoming[0] && <div style={{ color: TEXT }}>הבא לפרסום: {content.upcoming[0].title} ({heDate(content.upcoming[0].publishDate)})</div>}
                </div>}
          </div>
          <div style={{ background: CARD2, border: `1px solid ${BDR}`, borderRadius: 11, padding: "8px 10px", marginBottom: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: TEXT }}>השבוע (ראשון–שבת)</div>
            {!cad ? <div style={{ fontSize: 11.5, color: AMBER, marginTop: 3 }}>יעדים ומעקב לא נקראו כרגע — זה לא אומר שאין</div> : (() => {
              const w = cad.week; const gaps = w.signals.filter((x) => x.code !== "NO_TARGET").length; const act = cad.series.filter((x) => x.status === "ACTIVE");
              return <div style={{ fontSize: 11.5, color: TEXT2, marginTop: 3, lineHeight: 1.65 }}>
                פריטים שפורסמו: <b style={{ color: TEXT }}>{w.items.published}</b>{w.overall ? <> מתוך יעד <b style={{ color: TEXT }}>{w.overall.progress.required}</b></> : <span style={{ color: MUTED }}> · אין יעד</span>}
                <div>פרסומים בפלטפורמות: <b style={{ color: TEXT }}>{w.publications.total}</b>{w.publications.total > 0 && <span> ({Object.entries(w.publications.byPlatform).map(([p, n]) => `${PLATFORM_LABEL[p] ?? p} ${n}`).join(" · ")})</span>} · מתוכננים: <b style={{ color: TEXT }}>{w.items.plannedRemaining}</b></div>
                {gaps > 0 && <div style={{ color: AMBER }}>פערים: {gaps}</div>}
                <div>סדרות פעילות: {act.length ? act.map((x) => x.name).join(" · ") : <span style={{ color: MUTED }}>אין</span>}</div>
              </div>;
            })()}
          </div>
          <div style={{ fontSize: 12, color: TEXT2, marginBottom: 6 }}>
            תובנות והמלצות פתוחות של סאני: <b style={{ color: TEXT }}>{records.length}</b>{insp ? ` · השראות: ${insp}` : ""}
          </div>
          {records.slice(0, 2).map((r) => (
            <div key={r.id} style={{ fontSize: 12, color: TEXT, borderTop: `1px solid ${BDR}`, paddingTop: 5, marginTop: 4, overflowWrap: "anywhere" }}>
              <span style={{ color: r.fields.recordType === "INSIGHT" ? BLUE : GREEN, fontWeight: 800, fontSize: 10.5, marginInlineEnd: 6 }}>{r.fields.recordType === "INSIGHT" ? "תובנה" : "המלצה"}</span>
              {r.label.text}
              <span style={{ color: MUTED, fontSize: 10.5 }}> · {heDate(String(r.fields.createdOn ?? ""))}</span>
            </div>
          ))}
          {records.length > 0 && <div style={{ fontSize: 10.5, color: MUTED, marginTop: 5 }}>השערות של סאני — לא עובדות.</div>}
        </>
      )}
      <div style={{ flex: 1 }} />
      <button onClick={onOpen} disabled={unreadable} style={{
        marginTop: 12, padding: "8px 12px", borderRadius: 9, border: "1px solid rgba(220,38,38,0.45)", background: "rgba(220,38,38,0.10)",
        color: "#FF6B6B", fontSize: 12.5, fontWeight: 800, cursor: unreadable ? "default" : "pointer", opacity: unreadable ? 0.5 : 1,
      }}>לתצוגת הסושיאל המלאה ›</button>
    </div>
  );
}

/** The presentational part (pure over the artist_social answers). */
export function LabelArtistsCards({ cards, channels, isMobile, onOpen, onAdd = () => {} }: { cards: Card[]; channels: Array<{ resourceId: string; label: string; lastCheckedOn: string | null }>; isMobile: boolean; onOpen: (c: Card) => void; onAdd?: (c: Card) => void }) {
  return (
    <>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(auto-fit, minmax(280px, 1fr))" }}>
        {cards.map((c) => <ArtistCard key={c.key} c={c} onOpen={() => onOpen(c)} onAdd={() => onAdd(c)} />)}
      </div>
      {channels.length > 0 && (
        <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 11, border: "1px dashed rgba(245,158,11,0.40)", fontSize: 12, color: TEXT2 }}>
          <b style={{ color: AMBER }}>ערוץ לייבל משותף</b> — לא נספר לאף אמן:{" "}
          {channels.map((ch) => `${ch.label.replace(/^\S+ /, "")} (${ch.lastCheckedOn ? `בדיקה אחרונה ${heDate(ch.lastCheckedOn)}` : "לא נבדק"})`).join(" · ")}
        </div>
      )}
    </>
  );
}

export default function LabelArtistsSocial({ isMobile }: { isMobile: boolean }) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [channels, setChannels] = useState<Array<{ resourceId: string; label: string; lastCheckedOn: string | null }>>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [open, setOpen] = useState<Card | null>(null);
  const [openAdd, setOpenAdd] = useState(false);
  const [tick, setTick] = useState(0);
  const [dirty, setDirty] = useState(false);
  const close = () => { setOpen(null); setOpenAdd(false); if (dirty) { setDirty(false); setTick((t) => t + 1); } };

  useEffect(() => {
    let alive = true;
    api("mode=roster").then(async (ro) => {
      if (!alive) return;
      if (!ro || ro.status !== "OK" || ro.completeness === "UNKNOWN") { setState("error"); return; }
      setChannels((ro.summary.find((s) => s.code === "LABEL_CHANNELS")?.value as typeof channels) ?? []);
      const list = ro.items.map((i) => ({ key: String(i.entity), name: i.label.text }))
        .sort((a, b) => (ORDER.indexOf(a.name) + 1 || 99) - (ORDER.indexOf(b.name) + 1 || 99));
      const full = await Promise.all(list.map((a) => api(`mode=artist&limit=40&p.entity=${encodeURIComponent(a.key)}`).catch(() => null)));
      if (!alive) return;
      setCards(list.map((a, n) => ({ ...a, data: full[n] })));
      setState("ready");
    }).catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [tick]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, padding: "14px 20px 16px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>סושיאל אמני הלייבל</div>
        <div style={{ fontSize: 11, color: MUTED }}>רק חשבונות שאישרת כשל האמן · כל נתון עם תאריך הבדיקה שלו</div>
      </div>
      {state === "loading" ? (
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(3, minmax(0, 1fr))" }}>
          {[1, 2, 3].map((i) => <div key={i} style={{ height: 220, borderRadius: 14, background: CARD2, border: `1px solid ${BDR}` }} />)}
        </div>
      ) : state === "error" || !cards ? (
        <div style={{ fontSize: 13, color: AMBER, padding: "10px 0" }}>לא הצלחתי לקרוא את סושיאל האמנים כרגע — זה לא אומר שאין נתונים.</div>
      ) : <LabelArtistsCards cards={cards} channels={channels} isMobile={isMobile} onOpen={(c) => { setOpenAdd(false); setOpen(c); }} onAdd={(c) => { setOpenAdd(true); setOpen(c); }} />}

      {open?.data && (
        <div role="dialog" aria-modal="true" onClick={close} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.72)", display: "flex", justifyContent: "center", alignItems: "flex-start", overflowY: "auto", padding: isMobile ? "12px" : "40px 16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 920, background: "#0d0d12", border: `1px solid ${BDR}`, borderRadius: 18, padding: isMobile ? "14px 12px" : "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: TEXT }}>הסושיאל של {open.name}</div>
              <button onClick={close} aria-label="סגור" style={{ background: "transparent", border: `1px solid ${BDR}`, borderRadius: 8, color: TEXT2, fontSize: 14, padding: "3px 10px", cursor: "pointer" }}>✕</button>
            </div>
            <ArtistContentSection labelArtistId={open.key.slice("label-artist:".length)} artistName={open.name} autoOpenAdd={openAdd} onChanged={() => setDirty(true)} />
            <ArtistCadenceSection labelArtistId={open.key.slice("label-artist:".length)} artistName={open.name} isMobile={isMobile} onChanged={() => setDirty(true)} />
            <ArtistSocialView data={open.data as unknown as ArtistSocialResp} artistName={open.name} />
          </div>
        </div>
      )}
    </div>
  );
}
