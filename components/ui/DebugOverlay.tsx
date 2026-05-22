"use client";

/**
 * DebugOverlay — attaches to AppShell refs and reports live measurements.
 *
 * Activated by: ?debug=1 in the URL (works in both Safari and PWA).
 * Shows BOTH the initial snapshot (frame 0, before any touch) AND live values.
 * This lets us see the iOS PWA first-frame bug in action.
 *
 * Usage in AppShell:
 *   <DebugOverlay shellRef={shellRef} navRef={navRef} />
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";

interface Snap {
  innerH: number;
  visualH: number;
  docClientH: number;
  bodyClientH: number;
  shellH: number;
  navH: number;
  navTop: number;
  navBot: number;
  gap: number;          // innerH - navBot
  visualGap: number;    // visualH - navBot
  standalone: boolean;
  iosStandalone: boolean;
  sab: number;          // safe-area-inset-bottom in px
  ts: string;
}

function snap(
  shellRef: React.RefObject<HTMLElement | null>,
  navRef: React.RefObject<HTMLElement | null>
): Snap {
  const vv = window.visualViewport;
  const navR = navRef.current?.getBoundingClientRect();
  const shellR = shellRef.current?.getBoundingClientRect();

  // Read computed safe-area-inset-bottom
  const sentinel = document.getElementById("__sab_sentinel__");
  const sab = sentinel ? parseFloat(getComputedStyle(sentinel).height) || 0 : 0;

  const innerH = window.innerHeight;
  const visualH = vv ? Math.round(vv.height) : -1;
  const navBot = navR ? Math.round(navR.bottom) : -1;

  const now = new Date();
  const ts =
    String(now.getHours()).padStart(2, "0") + ":" +
    String(now.getMinutes()).padStart(2, "0") + ":" +
    String(now.getSeconds()).padStart(2, "0") + "." +
    String(now.getMilliseconds()).padStart(3, "0");

  return {
    innerH,
    visualH,
    docClientH: document.documentElement.clientHeight,
    bodyClientH: document.body.clientHeight,
    shellH: shellR ? Math.round(shellR.height) : -1,
    navH: navR ? Math.round(navR.height) : -1,
    navTop: navR ? Math.round(navR.top) : -1,
    navBot,
    gap: navBot >= 0 ? innerH - navBot : -1,
    visualGap: navBot >= 0 && visualH >= 0 ? visualH - navBot : -1,
    standalone: window.matchMedia("(display-mode: standalone)").matches,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    iosStandalone: !!(navigator as any).standalone,
    sab,
    ts,
  };
}

function Row({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
      <span style={{ color: "#6B7280", fontSize: 10 }}>{label}</span>
      <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: warn ? "#f87171" : "#F0F0F0" }}>
        {String(value)}
      </span>
    </div>
  );
}

function Panel({ title, s, color }: { title: string; s: Snap; color: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color, letterSpacing: "0.06em", marginBottom: 3 }}>
        {title} — {s.ts}
      </div>
      <Row label="innerH" value={s.innerH} />
      <Row label="visualH" value={s.visualH} />
      <Row label="docClientH" value={s.docClientH} />
      <Row label="bodyClientH" value={s.bodyClientH} />
      <Row label="shellH" value={s.shellH} warn={s.shellH !== s.innerH} />
      <Row label="navH" value={s.navH} />
      <Row label="nav.top" value={s.navTop} />
      <Row label="nav.bot" value={s.navBot} />
      <Row label="gap (inner-nav)" value={s.gap} warn={s.gap > 0} />
      <Row label="gap (visual-nav)" value={s.visualGap} warn={s.visualGap > 0} />
      <Row label="sab" value={`${s.sab}px`} />
      <Row label="standalone" value={`${s.standalone} / ios:${s.iosStandalone}`} />
    </div>
  );
}

export default function DebugOverlay({
  shellRef,
  navRef,
}: {
  shellRef: React.RefObject<HTMLElement | null>;
  navRef: React.RefObject<HTMLElement | null>;
}) {
  const searchParams = useSearchParams();
  const enabled = searchParams.get("debug") === "1";

  const [initial, setInitial] = useState<Snap | null>(null);
  const [live, setLive] = useState<Snap | null>(null);
  const [minimized, setMinimized] = useState(false);
  const initialized = useRef(false);

  // Inject safe-area-inset-bottom sentinel element
  useEffect(() => {
    if (!enabled) return;
    let el = document.getElementById("__sab_sentinel__");
    if (!el) {
      el = document.createElement("div");
      el.id = "__sab_sentinel__";
      el.style.cssText =
        "position:fixed;bottom:0;left:0;width:0;height:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none;z-index:-1;";
      document.body.appendChild(el);
    }
    return () => {
      const existing = document.getElementById("__sab_sentinel__");
      if (existing) existing.remove();
    };
  }, [enabled]);

  const take = useCallback(() => {
    if (!enabled) return;
    const s = snap(shellRef, navRef);
    setLive(s);
    if (!initialized.current) {
      setInitial(s);
      initialized.current = true;
    }
  }, [enabled, shellRef, navRef]);

  useEffect(() => {
    if (!enabled) return;

    // Frame 0 — before any layout settles
    take();
    // Frame 1
    requestAnimationFrame(take);
    // Short retries to catch iOS settling
    const t1 = setTimeout(take, 50);
    const t2 = setTimeout(take, 200);
    const t3 = setTimeout(take, 500);
    const interval = setInterval(take, 2000);

    const onTouch = () => {
      // Snapshot right after touch — this is when iOS usually corrects innerHeight
      take();
      setTimeout(take, 50);
    };
    window.addEventListener("touchstart", onTouch, { passive: true });
    window.addEventListener("touchend", onTouch, { passive: true });
    window.addEventListener("resize", take);

    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      clearInterval(interval);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("touchend", onTouch);
      window.removeEventListener("resize", take);
    };
  }, [enabled, take]);

  if (!enabled || !live) return null;

  const hasInitialDrift = initial && initial.innerH !== live.innerH;

  return (
    <div
      style={{
        position: "fixed",
        top: "max(54px, calc(env(safe-area-inset-top) + 8px))",
        left: 8,
        zIndex: 99999,
        background: "rgba(0,0,0,0.92)",
        border: `1px solid ${hasInitialDrift ? "#f87171" : "#2A2A2A"}`,
        borderRadius: 10,
        padding: minimized ? "6px 10px" : "10px 12px",
        width: minimized ? "auto" : 196,
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: minimized ? 0 : 8, cursor: "pointer" }}
        onClick={() => setMinimized((v) => !v)}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: "#60A5FA" }}>
          🔬 {live.standalone ? "PWA" : "Safari"}
          {hasInitialDrift ? " ⚠ DRIFT" : ""}
        </span>
        <span style={{ fontSize: 10, color: "#555", marginLeft: 6 }}>{minimized ? "▼" : "▲"}</span>
      </div>

      {!minimized && (
        <>
          {/* Live */}
          <Panel title="LIVE" s={live} color="#60A5FA" />

          {/* Initial — only show if different from live */}
          {initial && (
            <>
              <div style={{ height: 1, background: "#222", margin: "4px 0" }} />
              <Panel
                title={hasInitialDrift ? "INITIAL ⚠ (שונה מ-LIVE!)" : "INITIAL (זהה ל-LIVE ✓)"}
                s={initial}
                color={hasInitialDrift ? "#f87171" : "#4ade80"}
              />
              {hasInitialDrift && (
                <div style={{ fontSize: 9, color: "#f87171", marginTop: 4, lineHeight: 1.5 }}>
                  iOS viewport drift detected!{"\n"}
                  innerH שינה מ-{initial.innerH} ל-{live.innerH}
                </div>
              )}
            </>
          )}

          <div style={{ height: 1, background: "#222", margin: "6px 0 4px" }} />
          <div style={{ fontSize: 9, color: "#444" }}>
            gap={live.gap}px | vGap={live.visualGap}px
          </div>
        </>
      )}
    </div>
  );
}
