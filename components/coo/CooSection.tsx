"use client";

/**
 * Redbloods COO — Owner-only morning brief (Phase 1a, deterministic).
 *
 * Renders the server-computed Brief as-is: no client-side priority logic, no LLM.
 * Sits at the top of the Dashboard, above the KPI row; it does not replace or merge
 * any existing dashboard block. Free text that came from the DB is rendered as plain
 * (escaped) text only. Amounts are masked in Privacy Mode.
 */
import { useCallback, useEffect, useState } from "react";
import { useRole } from "@/lib/use-role";
import { usePrivacyMode } from "@/lib/use-privacy";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";
import type { Brief, Case, CoverageEntry, Evidence, Rich, Signal, Tier } from "@/lib/coo/types";

const BRAND = "#DC2626";
const CARD = "#181818";
const CARD2 = "#1E1E1E";
const BORDER = "rgba(255,255,255,0.07)";
const TEXT = "#F2F2F2";
const SUB = "#A0A0A0";
const MUTED = "#707070";

const TIER_STYLE: Record<Tier, { label: string; color: string; bg: string }> = {
  P0: { label: "P0 · דחוף", color: "#EF4444", bg: "rgba(239,68,68,0.12)" },
  P1: { label: "P1 · חשוב", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  P2: { label: "P2 · לבדוק", color: "#3B82F6", bg: "rgba(59,130,246,0.12)" },
  P3: { label: "P3 · לידיעה", color: "#6B7280", bg: "rgba(107,114,128,0.14)" },
};
const CONF_HE = { high: "גבוהה", medium: "בינונית", low: "נמוכה" } as const;
const MASK = "••••";

type LoadState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; brief: Brief };

function RichText({ parts, hide }: { parts: Rich; hide: boolean }) {
  return (
    <>
      {parts.map((p, i) =>
        p.s && hide ? <span key={i} aria-label="מוסתר" style={{ letterSpacing: "0.05em" }}>{MASK}</span> : <span key={i}>{p.t}</span>,
      )}
    </>
  );
}

/** Privacy Mode: masks currency amounts inside plain strings (notes, rules, data-quality details). */
const AMOUNT_RE = /[₪$€]\s?-?\d[\d,]*(?:\.\d+)?|-?\d[\d,]*(?:\.\d+)?\s?[₪$€]/g;
const maskAmounts = (text: string, hide: boolean) => (hide ? text.replace(AMOUNT_RE, MASK) : text);

function evidenceText(e: Evidence, hide: boolean): string {
  return e.kind === "money" && hide ? MASK : e.display;
}

function fmtAsOf(iso: string): string {
  try {
    return new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch { return iso; }
}

function Pill({ color, bg, children }: { color: string; bg: string; children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 99, color, background: bg, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: MUTED, margin: "12px 0 6px" }}>{children}</div>;
}

function CoverageList({ items, hide }: { items: CoverageEntry[]; hide: boolean }) {
  if (!items.length) return <div style={{ fontSize: 12, color: MUTED }}>—</div>;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
      {items.map((c) => (
        <li key={c.key} style={{ fontSize: 12, color: SUB, lineHeight: 1.5 }}>
          <b style={{ color: TEXT, fontWeight: 600 }}>{c.label}</b>
          {" · "}
          {c.total == null || c.usable == null ? "לא ידוע" : `${c.usable} מתוך ${c.total}`}
          {c.note ? <span style={{ color: MUTED }}> — {maskAmounts(c.note, hide)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function EvidenceTable({ items, hide }: { items: Evidence[]; hide: boolean }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 460, borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ color: MUTED, textAlign: "right" }}>
            <th style={{ fontWeight: 600, padding: "3px 6px 3px 10px" }}>עובדה</th>
            <th style={{ fontWeight: 600, padding: "3px 6px" }}>ערך</th>
            <th style={{ fontWeight: 600, padding: "3px 6px" }}>מקור</th>
            <th style={{ fontWeight: 600, padding: "3px 6px" }}>נכון ל-</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id} style={{ borderTop: `1px solid ${BORDER}` }}>
              <td style={{ padding: "4px 6px 4px 10px", color: SUB }}>{e.label}</td>
              <td style={{ padding: "4px 6px", color: TEXT, fontWeight: 600 }} title={e.untrusted ? "טקסט חופשי מהמערכת — מוצג כנתון בלבד" : undefined}>
                {evidenceText(e, hide)}
              </td>
              <td style={{ padding: "4px 6px", color: MUTED, direction: "ltr", textAlign: "right", whiteSpace: "nowrap" }}>
                {e.source.table}{e.source.field ? `.${e.source.field}` : ""}
              </td>
              <td style={{ padding: "4px 6px", color: MUTED, whiteSpace: "nowrap" }}>{fmtAsOf(e.asOf)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SignalWhy({ s, hide }: { s: Signal; hide: boolean }) {
  const t = TIER_STYLE[s.tier];
  return (
    <div style={{ background: CARD2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 12px", marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <Pill color={t.color} bg={t.bg}>{s.tier}</Pill>
        <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}><RichText parts={s.title} hide={hide} /></span>
        <span style={{ fontSize: 11, color: MUTED }}>{s.role === "primary" ? "סיגנל ראשי" : s.role === "supporting" ? "סיגנל תומך" : "הערה"}</span>
      </div>
      <EvidenceTable items={s.evidence} hide={hide} />
      {s.rules.length > 0 && (
        <>
          <SectionLabel>כללים שהופעלו</SectionLabel>
          <ul style={{ margin: 0, paddingInlineStart: 16, fontSize: 12, color: SUB, lineHeight: 1.6 }}>
            {s.rules.map((r) => (
              <li key={r.ruleId}>
                {maskAmounts(r.description, hide)}
                {r.threshold ? <span style={{ color: MUTED }}> · סף: {r.threshold}</span> : null}
                {r.observed ? <span style={{ color: MUTED }}> · נמדד: {maskAmounts(r.observed, hide)}</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}
      {s.tierReasons.length > 0 && (
        <>
          <SectionLabel>למה הדרגה {s.tier}</SectionLabel>
          <ul style={{ margin: 0, paddingInlineStart: 16, fontSize: 12, color: SUB, lineHeight: 1.6 }}>
            {s.tierReasons.map((r, i) => <li key={i}>{maskAmounts(r, hide)}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

function WhyPanel({ c, hide }: { c: Case; hide: boolean }) {
  const conf = c.confidence;
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${BORDER}` }}>
      <SectionLabel>למה הדרגה {c.tier}?</SectionLabel>
      <ul style={{ margin: 0, paddingInlineStart: 16, fontSize: 12, color: SUB, lineHeight: 1.6 }}>
        {c.tierReasons.map((r, i) => <li key={i}>{maskAmounts(r, hide)}</li>)}
      </ul>

      <SectionLabel>סיגנלים ועובדות ({c.signals.length})</SectionLabel>
      {c.signals.map((s) => <SignalWhy key={s.id} s={s} hide={hide} />)}

      {c.contextFacts.length > 0 && (
        <>
          <SectionLabel>הקשר (לא משנה את הדרגה)</SectionLabel>
          {c.contextFacts.map((f) => (
            <div key={f.id} style={{ background: CARD2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 12px", marginTop: 6 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, marginBottom: 4 }}>
                {f.title} <span style={{ color: SUB, fontWeight: 500 }}>· <RichText parts={f.short} hide={hide} /></span>
              </div>
              <EvidenceTable items={f.evidence} hide={hide} />
            </div>
          ))}
        </>
      )}

      {c.connections.length > 0 && (
        <>
          <SectionLabel>קשרים (לפי מזהה בלבד)</SectionLabel>
          <ul style={{ margin: 0, paddingInlineStart: 16, fontSize: 12, color: SUB, lineHeight: 1.6 }}>
            {c.connections.map((x, i) => (
              <li key={i}>
                {x.from.name} ← {x.to.name}{" "}
                <span style={{ color: MUTED, direction: "ltr", unicodeBidi: "embed" }}>({x.via})</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <SectionLabel>כיסוי כללי (מוצג תמיד; לא משנה את הדרגה)</SectionLabel>
      <CoverageList items={c.coverage} hide={hide} />

      {c.missing.length > 0 && (
        <>
          <SectionLabel>מה חסר / לא ידוע</SectionLabel>
          <ul style={{ margin: 0, paddingInlineStart: 16, fontSize: 12, color: "#D6A24A", lineHeight: 1.6 }}>
            {c.missing.map((m, i) => <li key={i}>{maskAmounts(m, hide)}</li>)}
          </ul>
        </>
      )}

      <SectionLabel>רמת ביטחון: {CONF_HE[conf.level]}</SectionLabel>
      <ul style={{ margin: 0, paddingInlineStart: 16, fontSize: 12, color: SUB, lineHeight: 1.6 }}>
        {conf.reasons.map((r, i) => <li key={i}>{maskAmounts(r, hide)}</li>)}
      </ul>
    </div>
  );
}

function CaseCard({ c, hide, open, onToggle, onOpenProject }: { c: Case; hide: boolean; open: boolean; onToggle: () => void; onOpenProject: (id: string) => void }) {
  const t = TIER_STYLE[c.tier];
  return (
    <article style={{ background: CARD, border: `1px solid ${BORDER}`, borderInlineStart: `3px solid ${t.color}`, borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Pill color={t.color} bg={t.bg}>{t.label}</Pill>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: TEXT }}>{c.title}</h3>
        {c.subtitle && <span style={{ fontSize: 12, color: MUTED }}>{c.subtitle}</span>}
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.55, color: SUB }}>
        <RichText parts={c.summary} hide={hide} />
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" onClick={onToggle} aria-expanded={open}
          style={{ fontSize: 12, fontWeight: 700, color: TEXT, background: "rgba(255,255,255,0.06)", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "5px 12px", cursor: "pointer" }}>
          {open ? "סגור" : "למה?"}
        </button>
        {c.entity.type === "project" && (
          <button type="button" onClick={() => onOpenProject(c.entity.id)}
            style={{ fontSize: 12, fontWeight: 600, color: SUB, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "5px 12px", cursor: "pointer" }}>
            פתח פרויקט
          </button>
        )}
        {c.confidence.level !== "high" && (
          <span style={{ fontSize: 11, color: "#D6A24A" }}>ביטחון {CONF_HE[c.confidence.level]} · {c.missing.length ? "יש נתונים חסרים" : "ראה פירוט"}</span>
        )}
      </div>
      {open && <WhyPanel c={c} hide={hide} />}
    </article>
  );
}

export default function CooSection() {
  const role = useRole();
  const [hide] = usePrivacyMode();
  const { openProject } = useGlobalProjectDrawer();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [staleOpen, setStaleOpen] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/coo/brief", { cache: "no-store", signal });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { brief: Brief };
      setState({ kind: "ready", brief: data.brief });
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    if (role !== "owner") return;
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [role, load]);

  // UI gate only — the route itself enforces requireOwner().
  if (role !== "owner") return null;

  const shell: React.CSSProperties = { background: "#131313", border: `1px solid ${BORDER}`, borderRadius: 16, padding: "14px 14px 12px", marginBottom: 18 };

  return (
    <section dir="rtl" aria-label="Redbloods COO" data-coo style={shell}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: BRAND }} />
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: TEXT }}>Redbloods COO</h2>
        <Pill color="#D6A24A" bg="rgba(214,162,74,0.12)">ספים ראשוניים — בכיול</Pill>
        {state.kind === "ready" && <span style={{ fontSize: 11, color: MUTED }}>נכון ל-{fmtAsOf(state.brief.meta.generatedAt)}</span>}
        <button type="button" onClick={() => load()} disabled={state.kind === "loading"}
          style={{ marginInlineStart: "auto", fontSize: 11.5, color: SUB, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "3px 10px", cursor: "pointer" }}>
          רענן
        </button>
      </header>

      {state.kind === "loading" && (
        <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[0, 1].map((i) => <div key={i} style={{ height: 64, borderRadius: 12, background: CARD, opacity: 0.5 }} />)}
        </div>
      )}

      {state.kind === "error" && (
        <div role="alert" style={{ fontSize: 13, color: "#F59E0B" }}>
          לא הצלחתי להרכיב את התדריך כרגע. שאר הדשבורד לא מושפע — אפשר ללחוץ על ״רענן״.
        </div>
      )}

      {state.kind === "ready" && (() => {
        const b = state.brief;
        const staleNotices = b.notices.filter((n) => n.type === "STALE_PROJECT_DEADLINE" || n.type === "STALE_INTERNAL_DEADLINE");
        const otherNotices = b.notices.filter((n) => !staleNotices.includes(n));
        const hasExtra = b.money.length > 0 || otherNotices.length > 0 || b.dataQuality.length > 0 || !!b.team.steven || !!b.team.victor;
        return (
          <>
            <p style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 800, color: TEXT, lineHeight: 1.4 }}>
              <RichText parts={b.headline} hide={hide} />
            </p>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: MUTED, lineHeight: 1.5 }}>{b.coverageLine}</p>

            {staleNotices.length > 0 && (
              <div style={{ marginBottom: 12, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "8px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Pill color="#6B7280" bg="rgba(107,114,128,0.14)">מידע לעדכון</Pill>
                  <span style={{ fontSize: 13, color: SUB }}>{staleNotices.map((n, i) => <span key={n.id}>{i > 0 ? " · " : ""}<RichText parts={n.title} hide={hide} /></span>)}</span>
                  <button type="button" onClick={() => setStaleOpen((v) => !v)} aria-expanded={staleOpen}
                    style={{ marginInlineStart: "auto", fontSize: 12, fontWeight: 700, color: TEXT, background: "rgba(255,255,255,0.06)", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "4px 12px", cursor: "pointer" }}>
                    {staleOpen ? "הסתר" : "הצג אילו"}
                  </button>
                </div>
                {staleOpen && (
                  <div style={{ marginTop: 8 }}>
                    {staleNotices.map((n) => (
                      <ul key={n.id} style={{ margin: "0 0 6px", paddingInlineStart: 16, fontSize: 12, color: SUB, lineHeight: 1.7 }}>
                        {n.evidence.filter((e) => e.id.startsWith("stale:p:") || e.id.startsWith("stale:w:")).map((e) => <li key={e.id}><b style={{ color: TEXT, fontWeight: 600 }}>{e.label}</b> — {e.display}</li>)}
                        <li style={{ color: MUTED, listStyle: "none", marginInlineStart: -16, marginTop: 4 }}>{n.missing[0]}</li>
                      </ul>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {b.cases.map((c) => (
                <CaseCard key={c.id} c={c} hide={hide} open={openId === c.id}
                  onToggle={() => setOpenId(openId === c.id ? null : c.id)} onOpenProject={openProject} />
              ))}
            </div>
            {(b.hiddenCaseCount > 0 || b.lowerTierCaseCount > 0) && (
              <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>
                {b.hiddenCaseCount > 0 ? (b.hiddenCaseCount === 1 ? "עוד דבר אחד בדרגה גבוהה (P0/P1) לא מוצג כאן. " : `עוד ${b.hiddenCaseCount} דברים בדרגה גבוהה (P0/P1) לא מוצגים כאן. `) : ""}
                {b.lowerTierCaseCount > 0 ? (b.lowerTierCaseCount === 1 ? "עוד דבר אחד בדרגה נמוכה יותר." : `עוד ${b.lowerTierCaseCount} דברים בדרגה נמוכה יותר.`) : ""}
              </div>
            )}

            {b.week.length > 0 && (
              <>
                <SectionLabel>7 הימים הקרובים</SectionLabel>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                  {b.week.map((w, i) => (
                    <li key={i} style={{ fontSize: 13, color: SUB, lineHeight: 1.5 }}>
                      <span style={{ color: MUTED }}>{w.daysTo <= 0 ? "היום" : w.daysTo === 1 ? "מחר" : `בעוד ${w.daysTo} ימים`} · </span>
                      <RichText parts={w.text} hide={hide} />
                    </li>
                  ))}
                </ul>
                {b.weekMore > 0 && <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>ועוד {b.weekMore}…</div>}
              </>
            )}

            {hasExtra && (
              <>
                <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more}
                  style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: SUB, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "5px 12px", cursor: "pointer" }}>
                  {more ? "פחות פירוט" : "כסף, צוות, כיסוי ואיכות נתונים"}
                </button>
                {more && (
                  <div style={{ marginTop: 6 }}>
                    {b.money.length > 0 && (
                      <>
                        <SectionLabel>כסף (לפי מטבע — בלי חיבור בין מטבעות)</SectionLabel>
                        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                          {b.money.map((m) => (
                            <li key={m.id} style={{ fontSize: 13, color: SUB, lineHeight: 1.5 }}>
                              <b style={{ color: TEXT, fontWeight: 600 }}>{m.label}: </b><RichText parts={m.text} hide={hide} />
                              {m.note ? <span style={{ color: MUTED }}> — {maskAmounts(m.note, hide)}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {(b.team.steven || b.team.victor) && (
                      <>
                        <SectionLabel>צוות</SectionLabel>
                        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                          {b.team.steven && <li style={{ fontSize: 13, color: SUB }}><b style={{ color: TEXT, fontWeight: 600 }}>Steven: </b><RichText parts={b.team.steven} hide={hide} /></li>}
                          {b.team.victor && <li style={{ fontSize: 13, color: SUB }}><b style={{ color: TEXT, fontWeight: 600 }}>Victor: </b><RichText parts={b.team.victor} hide={hide} /></li>}
                        </ul>
                      </>
                    )}
                    {otherNotices.length > 0 && (
                      <>
                        <SectionLabel>הערות</SectionLabel>
                        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                          {otherNotices.map((n) => <li key={n.id} style={{ fontSize: 13, color: SUB, lineHeight: 1.5 }}><RichText parts={n.title} hide={hide} /></li>)}
                        </ul>
                      </>
                    )}
                    <SectionLabel>כיסוי הנתונים</SectionLabel>
                    <CoverageList items={b.coverage} hide={hide} />
                    {b.dataQuality.length > 0 && (
                      <>
                        <SectionLabel>איכות נתונים ({b.dataQuality.length})</SectionLabel>
                        <ul style={{ margin: 0, paddingInlineStart: 16, fontSize: 12, color: SUB, lineHeight: 1.6 }}>
                          {b.dataQuality.map((d) => <li key={d.id}><b style={{ color: TEXT, fontWeight: 600 }}>{d.label}</b> ({d.count}) — {maskAmounts(d.detail, hide)}</li>)}
                        </ul>
                      </>
                    )}
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 10 }}>
                      מקורות: {b.sources.map((s) => `${s.source}${s.status === "ok" ? "" : " (לא זמין)"}`).join(" · ")}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        );
      })()}
    </section>
  );
}
