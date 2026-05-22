"use client";

/**
 * /mobile-test — Standalone diagnostic page
 *
 * Zero AppShell. Zero Supabase. Zero heavy components.
 * Purpose: isolate whether the iOS layout bug is in AppShell/BottomNav
 * or in global CSS / PWA viewport / manifest / cache.
 *
 * If this page looks correct on iPhone → bug is in AppShell or real BottomNav.
 * If this page also has the gap → bug is global (CSS / PWA / iOS).
 */

import { useEffect, useRef, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Snapshot {
  innerH: number;
  visualH: number;
  docClientH: number;
  bodyClientH: number;
  docOffsetH: number;
  shellH: number;
  navH: number;
  navBottom: number;
  navTop: number;
  isStandalone: boolean;
  isIOSStandalone: boolean;
  ua: string;
  safeBottom: number;
  ts: string;
}

function emptySnapshot(): Snapshot {
  return {
    innerH: 0, visualH: 0, docClientH: 0, bodyClientH: 0,
    docOffsetH: 0, shellH: 0, navH: 0, navBottom: 0, navTop: 0,
    isStandalone: false, isIOSStandalone: false,
    ua: "", safeBottom: 0, ts: "",
  };
}

// ─── Measurement helper ────────────────────────────────────────────────────────

function measure(shellRef: React.RefObject<HTMLDivElement | null>, navRef: React.RefObject<HTMLElement | null>): Snapshot {
  const vv = window.visualViewport;
  const navRect = navRef.current?.getBoundingClientRect();
  const shellRect = shellRef.current?.getBoundingClientRect();

  // Read env(safe-area-inset-bottom) via computed style
  const safeBottom = parseFloat(
    getComputedStyle(document.documentElement)
      .getPropertyValue("--sab") || "0"
  ) || 0;

  const ua = navigator.userAgent;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isIOSStandalone = !!(navigator as any).standalone;

  const now = new Date();
  const ts = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}.${String(now.getMilliseconds()).padStart(3,"0")}`;

  return {
    innerH: window.innerHeight,
    visualH: vv ? Math.round(vv.height) : -1,
    docClientH: document.documentElement.clientHeight,
    bodyClientH: document.body.clientHeight,
    docOffsetH: document.documentElement.offsetHeight,
    shellH: shellRect ? Math.round(shellRect.height) : -1,
    navH: navRect ? Math.round(navRect.height) : -1,
    navBottom: navRect ? Math.round(navRect.bottom) : -1,
    navTop: navRect ? Math.round(navRect.top) : -1,
    isStandalone,
    isIOSStandalone,
    ua: ua.replace(/.*\(/, "").replace(/\).*/, "").slice(0, 60),
    safeBottom,
    ts,
  };
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function MobileTestPage() {
  const shellRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [snap, setSnap] = useState<Snapshot>(emptySnapshot);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [showNav, setShowNav] = useState(true);
  const [pwaDebug, setPwaDebug] = useState(false);

  useEffect(() => {
    setPwaDebug(localStorage.getItem("rb_debug") === "1");
  }, []);

  const take = useCallback(() => {
    const s = measure(shellRef, navRef);
    setSnap(s);
    setHistory((h) => [s, ...h].slice(0, 8));
  }, []);

  // Set CSS var for safe-area-inset-bottom so we can read it in JS
  useEffect(() => {
    // Inject a sentinel element to read the computed safe area
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;bottom:0;left:0;width:0;height:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none;";
    document.body.appendChild(el);
    const readSAB = () => {
      const h = parseFloat(getComputedStyle(el).height) || 0;
      document.documentElement.style.setProperty("--sab", String(h));
    };
    readSAB();
    window.addEventListener("resize", readSAB);
    return () => { window.removeEventListener("resize", readSAB); document.body.removeChild(el); };
  }, []);

  // Initial measurement + interval
  useEffect(() => {
    take();
    const id = setInterval(take, 1000);
    return () => clearInterval(id);
  }, [take]);

  // Measure on touch/interaction — to see if values change after user touches screen
  useEffect(() => {
    const onTouch = () => take();
    window.addEventListener("touchstart", onTouch, { passive: true });
    window.addEventListener("touchend", onTouch, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("touchend", onTouch);
    };
  }, [take]);

  // Helper: did nav reach screen bottom?
  const navGap = snap.innerH > 0 && snap.navBottom > 0
    ? snap.innerH - snap.navBottom
    : null;
  const visualNavGap = snap.visualH > 0 && snap.navBottom > 0
    ? snap.visualH - snap.navBottom
    : null;

  return (
    /**
     * SHELL: position fixed inset 0 flex-col
     * This is the exact same technique as AppShell.
     * If THIS has a gap → problem is global.
     * If this is fine → problem is inside AppShell's internals.
     */
    <div
      ref={shellRef}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "#0D0D0D",
        fontFamily: "'Heebo', Arial, sans-serif",
        color: "#F0F0F0",
      }}
    >
      {/* ── HEADER ── */}
      <header
        style={{
          background: "#141414",
          borderBottom: "1px solid #2A2A2A",
          paddingTop: "max(14px, env(safe-area-inset-top))",
          paddingBottom: 12,
          paddingLeft: 16,
          paddingRight: 16,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: 56,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700 }}>🔬 Mobile Debug</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setOverlayVisible((v) => !v)}
            style={{ fontSize: 11, background: "#1A1A1A", border: "1px solid #333", borderRadius: 8, padding: "4px 10px", color: "#AAA", cursor: "pointer" }}
          >
            {overlayVisible ? "הסתר overlay" : "הצג overlay"}
          </button>
          <button
            onClick={() => setShowNav((v) => !v)}
            style={{ fontSize: 11, background: "#1A1A1A", border: "1px solid #333", borderRadius: 8, padding: "4px 10px", color: "#AAA", cursor: "pointer" }}
          >
            {showNav ? "הסתר nav" : "הצג nav"}
          </button>
        </div>
      </header>

      {/* ── SCROLLABLE CONTENT ── */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        <div style={{ padding: "16px 16px 0" }}>

          {/* Mode badge */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <span style={{
              fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 100,
              background: snap.isStandalone ? "#052e16" : "#1a1a2e",
              border: `1px solid ${snap.isStandalone ? "#16a34a" : "#3B82F6"}`,
              color: snap.isStandalone ? "#4ade80" : "#93c5fd",
            }}>
              {snap.isStandalone ? "✓ standalone (PWA)" : "Safari browser"}
            </span>
            {snap.isIOSStandalone && (
              <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 100, background: "#052e16", border: "1px solid #16a34a", color: "#4ade80" }}>
                ✓ navigator.standalone
              </span>
            )}
          </div>

          {/* ── MEASUREMENTS ── */}
          <Section title="📐 Viewport Heights">
            <Row
              label="window.innerHeight"
              value={snap.innerH}
              ok={snap.innerH > 0}
              note="הכי בעייתי ב-iOS PWA — יכול להיות שגוי בפתיחה"
            />
            <Row
              label="visualViewport.height"
              value={snap.visualH === -1 ? "N/A" : snap.visualH}
              ok={snap.visualH > 0}
              note="המדויק ביותר — מה שהמשתמש רואה בפועל"
            />
            <Row
              label="document.documentElement.clientHeight"
              value={snap.docClientH}
              ok={snap.docClientH > 0}
              note="גובה ה-html element"
            />
            <Row
              label="document.body.clientHeight"
              value={snap.bodyClientH}
              ok={snap.bodyClientH > 0}
              note="גובה ה-body — אמור להיות גדול מ-innerH אם min-height:100dvh"
            />
            <Row
              label="document.documentElement.offsetHeight"
              value={snap.docOffsetH}
              ok={snap.docOffsetH > 0}
            />
          </Section>

          <Section title="📦 Element Heights">
            <Row
              label="shell element (this div)"
              value={snap.shellH}
              ok={snap.shellH > 0}
              note="גובה ה-div הקורן של הדף הזה"
            />
            <Row
              label="bottom nav height"
              value={showNav ? snap.navH : "hidden"}
              ok={showNav ? snap.navH > 0 : true}
            />
            <Row
              label="nav.getBoundingClientRect().top"
              value={showNav ? snap.navTop : "hidden"}
              ok={true}
            />
            <Row
              label="nav.getBoundingClientRect().bottom"
              value={showNav ? snap.navBottom : "hidden"}
              ok={true}
            />
          </Section>

          <Section title="🕳️ Gap Analysis">
            <Row
              label="innerHeight − nav.bottom (gap below nav)"
              value={navGap !== null && showNav ? navGap : "—"}
              ok={navGap === 0 || navGap === null}
              okColor={navGap === 0 ? "#4ade80" : navGap !== null && navGap > 0 ? "#f87171" : "#888"}
              note={navGap !== null && navGap > 0 ? `⚠ יש gap של ${navGap}px מתחת ל-nav!` : navGap === 0 ? "✓ nav נצמד לתחתית" : ""}
            />
            <Row
              label="visualH − nav.bottom (visual gap)"
              value={visualNavGap !== null && showNav ? visualNavGap : "—"}
              ok={visualNavGap === 0 || visualNavGap === null}
              okColor={visualNavGap === 0 ? "#4ade80" : visualNavGap !== null && visualNavGap > 0 ? "#f87171" : "#888"}
              note={visualNavGap !== null && visualNavGap > 0 ? `⚠ gap ויזואלי ${visualNavGap}px` : ""}
            />
            <Row
              label="innerH === visualH"
              value={snap.innerH === snap.visualH ? "✓ שווים" : `✗ שונים (${snap.innerH} vs ${snap.visualH})`}
              ok={snap.innerH === snap.visualH}
            />
            <Row
              label="shellH === innerH"
              value={snap.shellH === snap.innerH ? "✓ שווים" : `✗ שונים (${snap.shellH} vs ${snap.innerH})`}
              ok={snap.shellH === snap.innerH}
            />
          </Section>

          <Section title="📱 Device Info">
            <Row label="display-mode: standalone" value={String(snap.isStandalone)} ok={true} />
            <Row label="navigator.standalone" value={String(snap.isIOSStandalone)} ok={true} />
            <Row label="UserAgent (device part)" value={snap.ua} ok={true} />
          </Section>

          {/* ── History ── */}
          {history.length > 1 && (
            <Section title="⏱ History (innerH | visualH | nav.bottom)">
              {history.map((h, i) => (
                <div key={i} style={{ fontSize: 11, fontFamily: "monospace", color: i === 0 ? "#F0F0F0" : "#666", padding: "2px 0" }}>
                  {h.ts} → innerH={h.innerH} | visH={h.visualH} | nav.bot={h.navBottom}
                </div>
              ))}
            </Section>
          )}

          {/* ── PWA Debug Toggle ── */}
          <Section title="📱 הפעלת Debug ב-PWA">
            <div style={{ padding: "12px 12px" }}>
              <p style={{ fontSize: 12, color: "#AAA", lineHeight: 1.7, marginBottom: 10 }}>
                כדי לראות את ה-debug overlay בתוך ה-PWA (מסך הבית),
                הפעל כאן ← פתח את ה-PWA ← הoverlay יופיע אוטומטית.
              </p>
              <button
                onClick={() => {
                  const next = !pwaDebug;
                  if (next) localStorage.setItem("rb_debug", "1");
                  else localStorage.removeItem("rb_debug");
                  setPwaDebug(next);
                }}
                style={{
                  width: "100%", padding: "12px 16px", borderRadius: 12,
                  background: pwaDebug ? "#052e16" : "#1A1A1A",
                  border: `1px solid ${pwaDebug ? "#16a34a" : "#333"}`,
                  color: pwaDebug ? "#4ade80" : "#AAA",
                  fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {pwaDebug ? "✓ Debug PWA פעיל — לחץ לכיבוי" : "הפעל Debug ב-PWA"}
              </button>
            </div>
          </Section>

          {/* ── Instructions ── */}
          <Section title="📋 איך לקרוא תוצאות">
            <p style={{ fontSize: 12, color: "#AAA", lineHeight: 1.7 }}>
              1. <strong style={{ color: "#F0F0F0" }}>gap below nav = 0</strong> ← תקין, nav בתחתית<br />
              2. <strong style={{ color: "#f87171" }}>gap &gt; 0</strong> ← הבעיה כאן — nav לא מגיע לתחתית<br />
              3. <strong style={{ color: "#F0F0F0" }}>הסתר nav</strong> → בדוק אם shellH === innerH (ה-shell ממלא את המסך)<br />
              4. <strong style={{ color: "#F0F0F0" }}>innerH !== visualH</strong> ← iOS viewport bug קיים<br />
              5. <strong style={{ color: "#F0F0F0" }}>shellH !== innerH</strong> ← ה-shell לא מקבל גובה נכון<br />
              6. <strong style={{ color: "#F0F0F0" }}>אחרי scroll/נגיעה</strong> — האם הערכים משתנים?
            </p>
          </Section>

          <div style={{ height: 32 }} />
        </div>
      </div>

      {/* ── BOTTOM NAV (minimal, no real MobileNav) ── */}
      {showNav && (
        <nav
          ref={navRef}
          style={{
            background: "#141414",
            borderTop: "1px solid #2A2A2A",
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            flexShrink: 0,
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          {[
            { icon: "⬡", label: "דשבורד" },
            { icon: "♫", label: "פרויקטים" },
            { icon: "₪", label: "כספים" },
            { icon: "📅", label: "יומן" },
          ].map(({ icon, label }) => (
            <div
              key={label}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                gap: 3, padding: "10px 0", minHeight: 56,
                color: "#666", fontSize: 10, fontWeight: 600,
              }}
            >
              <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>
              {label}
            </div>
          ))}
        </nav>
      )}

      {/* ── DEBUG OVERLAY (top-right corner) ── */}
      {overlayVisible && (
        <div
          style={{
            position: "fixed",
            top: "max(50px, calc(env(safe-area-inset-top) + 8px))",
            left: 8,
            zIndex: 9999,
            background: "rgba(0,0,0,0.88)",
            border: "1px solid #333",
            borderRadius: 10,
            padding: "8px 10px",
            fontSize: 10,
            fontFamily: "monospace",
            color: "#9CA3AF",
            lineHeight: 1.7,
            maxWidth: 170,
            pointerEvents: "none",
          }}
        >
          <div style={{ color: "#60A5FA", fontWeight: 700, marginBottom: 2 }}>
            {snap.isStandalone ? "PWA" : "Safari"} {snap.ts}
          </div>
          <div>innerH: <Val v={snap.innerH} /></div>
          <div>visualH: <Val v={snap.visualH === -1 ? "N/A" : snap.visualH} /></div>
          <div>docClient: <Val v={snap.docClientH} /></div>
          <div>shell: <Val v={snap.shellH} /></div>
          <div>navBot: <Val v={showNav ? snap.navBottom : "hidden"} /></div>
          <div style={{ borderTop: "1px solid #333", marginTop: 3, paddingTop: 3 }}>
            gap: <span style={{ color: navGap === 0 ? "#4ade80" : navGap != null && navGap > 0 ? "#f87171" : "#888", fontWeight: 700 }}>
              {showNav && navGap !== null ? `${navGap}px` : "—"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helper components ─────────────────────────────────────────────────────────

function Val({ v }: { v: string | number }) {
  return <span style={{ color: "#F0F0F0" }}>{v}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#4A4A4A", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ background: "#141414", borderRadius: 12, border: "1px solid #1E1E1E", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

function Row({
  label, value, ok, okColor, note,
}: {
  label: string;
  value: string | number;
  ok: boolean;
  okColor?: string;
  note?: string;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", padding: "8px 12px",
      borderBottom: "1px solid #1A1A1A",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "#666", flex: 1 }}>{label}</span>
        <span style={{
          fontSize: 12, fontWeight: 700, fontFamily: "monospace",
          color: okColor ?? (ok ? "#4ade80" : "#f87171"),
          whiteSpace: "nowrap",
        }}>
          {String(value)}
        </span>
      </div>
      {note && (
        <span style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{note}</span>
      )}
    </div>
  );
}
