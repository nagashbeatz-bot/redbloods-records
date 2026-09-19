"use client";

/**
 * ViewportProbe — TEMPORARY diagnostic for the iOS PWA "bottom nav jumps up" bug.
 * Delete this file + the one <ViewportProbe/> line (and the data-rb-* attributes)
 * in AppShell to remove it completely. It changes NO app behaviour.
 *
 * OFF by default. Toggle: 5 quick taps on the Redbloods logo in the mobile header
 * (works inside the home-screen PWA, where there is no URL bar), or ?debug=1
 * (on) / ?debug=0 (off). The state is kept in localStorage (`rb_probe`) so it
 * survives page navigation — AppShell remounts on every route.
 *
 * What it does when ON: renders ONE fixed, non-interactive layer under <body>
 * (except the RESET button) that shows LIVE numbers and a frozen ONSET snapshot.
 * A dashed frame at `position:fixed; inset:0` draws where the browser thinks the
 * fixed-position coordinate system is, so a screenshot shows if all of it moved.
 * Nothing leaves the device: no fetch, no beacon, no storage besides the flag.
 * Values are written straight into the DOM (no React state) so it causes no
 * re-render of the app.
 *
 * NOTE: getBoundingClientRect() reports MAIN-THREAD layout. If the jump is a
 * compositor / UI-process desync, the numbers can look normal while the screen is
 * wrong — then ONSET stays empty and the dashed frame + screenshot are the evidence.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsClient } from "@/lib/use-is-client";

const LS_KEY = "rb_probe";
const TAP_COUNT = 5;          // taps needed on the logo
const TAP_GAP_MS = 900;       // max gap between two taps
const TAP_TOTAL_MS = 3500;    // max time for all taps
const TAP_MAX_MOVE = 14;      // px — more than this is a drag/scroll, not a tap
const TAP_MAX_HOLD = 450;     // ms — longer is a press, not a tap
const SETTLE_MS = 800;        // ignore anomalies right after a (re)mount / route change

// ── module state: survives AppShell remounts during client-side navigation ─────
interface Ev { t: number; wall: number; name: string; detail: string; n: number }
const events: Ev[] = [];
let mountCount = 0;
let inAnomaly = false;
let episodes = 0;
let inVv = false;
let vvEpisodes = 0;
let vvFirst: string | null = null;
interface Onset { head: string; why: string; lines: string[]; ev: string[] }
let onset: Onset | null = null;

const n1 = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) ? String(Math.round(v * 10) / 10) : "–";
const pad2 = (v: number) => String(v).padStart(2, "0");
const hms = (wall: number) => {
  const d = new Date(wall);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};
const up = () => (performance.now() / 1000).toFixed(1);

/** Record an event. Repeats of the same event within 2s are folded into one line
 *  (×n, moved to the end) so scroll floods can't push the informative ones out. */
function log(name: string, detail = "") {
  const now = performance.now();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.name === name && e.detail === detail && now - e.t < 2000) {
      e.n++; e.t = now; e.wall = Date.now();
      events.splice(i, 1); events.push(e);
      return;
    }
  }
  events.push({ t: now, wall: Date.now(), name, detail, n: 1 });
  if (events.length > 60) events.shift();
}

const evLine = (e: Ev) =>
  `${hms(e.wall)} +${(e.t / 1000).toFixed(1)} ${e.name}${e.n > 1 ? "×" + e.n : ""}${e.detail ? " " + e.detail : ""}`;
const recentEv = (k = 7) => events.slice(-k).map(evLine);

interface Snap { lines: string[]; bad: boolean; why: string; vvBad: boolean; vvWhy: string }

function collect(measuredNavH: number | null, sentinel: HTMLElement | null, mountedAt: number): Snap {
  const w = window, d = document;
  const vv = w.visualViewport;
  const se = (d.scrollingElement ?? d.documentElement) as HTMLElement;
  const iH = w.innerHeight, iW = w.innerWidth, cH = d.documentElement.clientHeight;
  const sT = se.scrollTop, sH = se.scrollHeight;
  const max = sH - se.clientHeight;
  const ovs = sT < -0.5 || sT > max + 0.5; // rubber-banding past either end

  const nav = d.querySelector<HTMLElement>("nav.app-shell-nav");
  const hdr = d.querySelector<HTMLElement>(".app-shell-main > header");
  const mp = d.querySelector<HTMLElement>("[data-rb-miniplayer]");
  const content = d.querySelector<HTMLElement>(".app-shell-content");

  const L: string[] = [];
  L.push(`iH ${n1(iH)} iW ${n1(iW)} cH ${n1(cH)}`);
  L.push(`sY ${n1(w.scrollY)} sT ${n1(sT)}`);
  L.push(`sH ${n1(sH)} max ${n1(max)}${ovs ? " OVS" : ""}`);
  if (vv) {
    L.push(`VV h${n1(vv.height)} w${n1(vv.width)}`);
    L.push(`VV oT${n1(vv.offsetTop)} oL${n1(vv.offsetLeft)}`);
    L.push(`VV pT${n1(vv.pageTop)} pL${n1(vv.pageLeft)} x${n1(vv.scale)}`);
  } else {
    L.push("VV n/a");
  }

  let bad = false, why = "";
  const settled = performance.now() - mountedAt > SETTLE_MS && d.visibilityState === "visible";

  let navRect: DOMRect | null = null;
  if (nav) {
    navRect = nav.getBoundingClientRect();
    const cs = getComputedStyle(nav);
    L.push(`NAV t${n1(navRect.top)} b${n1(navRect.bottom)} h${n1(navRect.height)}`);
    L.push(`NAV ${cs.position} T:${cs.top} B:${cs.bottom}`);
    L.push(`NAV tf:${cs.transform} tr:${(cs as CSSStyleDeclaration & { translate?: string }).translate ?? "n/a"}`);
    const gI = navRect.bottom - iH;
    L.push(`b-iH ${n1(gI)}  b-vvH ${vv ? n1(navRect.bottom - vv.height) : "–"}`);
    L.push(`b-(oT+vvH) ${vv ? n1(navRect.bottom - (vv.offsetTop + vv.height)) : "–"}`);
    if (settled && !ovs && navRect.height > 0 && Math.abs(gI) > 1.5) { bad = true; why = `NAV b-iH=${n1(gI)}`; }
  } else {
    L.push("NAV (not mounted)");
  }

  if (hdr) {
    const r = hdr.getBoundingClientRect();
    L.push(`HDR t${n1(r.top)} b${n1(r.bottom)} h${n1(r.height)}`);
    if (settled && !ovs && r.height > 0 && Math.abs(r.top) > 1.5) { bad = true; why += (why ? " + " : "") + `HDR t=${n1(r.top)}`; }
  } else {
    L.push("HDR (none)");
  }

  if (mp) {
    const r = mp.getBoundingClientRect();
    const cs = getComputedStyle(mp);
    const inView = r.height > 0 && r.top < iH - 1;
    L.push(`MP t${n1(r.top)} b${n1(r.bottom)} h${n1(r.height)}`);
    L.push(`MP B:${cs.bottom} pe:${cs.pointerEvents} ${inView ? "IN-VIEW" : "out"}`);
    L.push(`MP tf:${cs.transform}`);
  } else {
    L.push("MP (none)");
  }

  const rectH = navRect ? navRect.height : null;
  L.push(`PADB ${content ? getComputedStyle(content).paddingBottom : "–"} navH ${n1(measuredNavH)}/${n1(rectH)}`);

  const sa = sentinel ? getComputedStyle(sentinel) : null;
  L.push(`SA t${sa ? sa.paddingTop : "–"} b${sa ? sa.paddingBottom : "–"}`);
  const nav2 = navigator as Navigator & { standalone?: boolean };
  L.push(`sa:${String(nav2.standalone)} dm:${w.matchMedia("(display-mode: standalone)").matches}`);

  let vvBad = false, vvWhy = "";
  if (vv) {
    const dH = vv.height - iH;
    if (Math.abs(vv.offsetTop) > 1.5 || Math.abs(dH) > 1.5 || Math.abs(vv.scale - 1) > 0.01) {
      vvBad = true; vvWhy = `oT${n1(vv.offsetTop)} dH${n1(dH)} x${n1(vv.scale)}`;
    }
  }
  L.push(`VVanom eps ${vvEpisodes}${inVv ? " NOW" : ""}`);
  if (vvFirst) L.push(`  first ${vvFirst}`);
  L.push(`anom eps ${episodes}${inAnomaly ? " NOW" : ""}  mounts ${mountCount}`);

  const metas = Array.from(d.querySelectorAll<HTMLMetaElement>('meta[name="viewport"]'));
  L.push(`META viewport ×${metas.length}`);
  metas.forEach((m, i) => L.push(`${i + 1}: ${m.getAttribute("content") ?? ""}`));

  return { lines: L, bad, why, vvBad, vvWhy };
}

function toast(msg: string) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText =
    "position:fixed;left:50%;top:40%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;" +
    "background:#DC2626;color:#fff;font:700 16px/1 -apple-system,system-ui,sans-serif;padding:10px 16px;border-radius:10px;";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

/** Always mounted by AppShell. Renders nothing unless the probe is switched ON. */
export default function ViewportProbe({ measuredNavH }: { measuredNavH: number | null }) {
  const isClient = useIsClient();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const read = () => { try { return localStorage.getItem(LS_KEY) === "1"; } catch { return false; } };
    try {
      const q = new URLSearchParams(window.location.search).get("debug");
      if (q === "1") localStorage.setItem(LS_KEY, "1");
      else if (q === "0") localStorage.removeItem(LS_KEY);
    } catch { /* storage blocked → probe simply stays off */ }
    setEnabled(read());

    // 5 quick taps on the logo toggle the probe. Passive listeners, never
    // preventDefault, and every non-tap (drag, long press, tap elsewhere) resets it.
    let down: { x: number; y: number; t: number } | null = null;
    let count = 0, firstT = 0, lastT = 0;
    const onDown = (e: PointerEvent) => {
      down = e.isPrimary ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    };
    const onUp = (e: PointerEvent) => {
      const dn = down; down = null;
      if (!dn || !e.isPrimary) { count = 0; return; }
      const now = performance.now();
      const moved = Math.hypot(e.clientX - dn.x, e.clientY - dn.y);
      const onLogo = e.target instanceof Element && !!e.target.closest("[data-rb-logo]");
      if (!onLogo || moved > TAP_MAX_MOVE || now - dn.t > TAP_MAX_HOLD) { count = 0; return; }
      if (count === 0 || now - lastT > TAP_GAP_MS || now - firstT > TAP_TOTAL_MS) { count = 0; firstT = now; }
      count++; lastT = now;
      if (count >= TAP_COUNT) {
        count = 0;
        const next = !read();
        try { if (next) localStorage.setItem(LS_KEY, "1"); else localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
        setEnabled(next);
        toast(next ? "PROBE ON" : "PROBE OFF");
      }
    };
    document.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    document.addEventListener("pointerup", onUp, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown, { capture: true });
      document.removeEventListener("pointerup", onUp, { capture: true });
    };
  }, []);

  if (!isClient || !enabled) return null;
  return <ProbeOverlay measuredNavH={measuredNavH} />;
}

const TAG: React.CSSProperties = {
  position: "absolute", left: 4, font: "700 9px/1 ui-monospace,Menlo,monospace",
  color: "#fff", background: "#C026D3", padding: "2px 4px", borderRadius: 3,
};
const PRE: React.CSSProperties = {
  margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all",
  font: "9px/1.25 ui-monospace,SFMono-Regular,Menlo,monospace", color: "#E5E5E5",
};

function ProbeOverlay({ measuredNavH }: { measuredNavH: number | null }) {
  const liveRef = useRef<HTMLPreElement>(null);
  const onsetRef = useRef<HTMLPreElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const navHRef = useRef<number | null>(measuredNavH);
  navHRef.current = measuredNavH;
  const updateRef = useRef<() => void>(() => {});

  useEffect(() => {
    mountCount++;
    log("mount", `#${mountCount}`);
    const mountedAt = performance.now();
    const w = window, d = document, vv = w.visualViewport;

    const update = () => {
      const s = collect(navHRef.current, sentinelRef.current, mountedAt);
      if (s.bad && !inAnomaly) {
        episodes++;
        if (!onset) {
          onset = {
            head: `@${hms(Date.now())} +${up()}s`,
            why: s.why, lines: s.lines.slice(), ev: recentEv(),
          };
        }
      }
      inAnomaly = s.bad;
      if (s.vvBad && !inVv) { vvEpisodes++; if (vvFirst === null) vvFirst = `+${up()}s ${s.vvWhy}`; }
      inVv = s.vvBad;

      if (liveRef.current) {
        liveRef.current.textContent =
          [`${hms(Date.now())} +${up()}s`, ...s.lines, "-- events --", ...recentEv()].join("\n");
      }
      if (onsetRef.current) {
        onsetRef.current.textContent = onset
          ? [onset.head, onset.why, ...onset.lines, "-- events --", ...onset.ev].join("\n")
          : "— none yet —\n(nav/header out of\nplace → frozen here)";
      }
    };
    updateRef.current = update;

    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); };
    const h = (name: string, detail?: (e: Event) => string) => (e: Event) => { log(name, detail ? detail(e) : ""); schedule(); };
    const tag = (e: Event) => (e.target instanceof Element ? e.target.tagName.toLowerCase() : "");

    const hScroll = h("scroll"), hResize = h("resize"), hVvScroll = h("vv.scroll"), hVvResize = h("vv.resize");
    const hFocusIn = h("focusin", tag), hFocusOut = h("focusout", tag);
    const hVis = h("visibilitychange", () => d.visibilityState);
    const hShow = h("pageshow", (e) => ((e as PageTransitionEvent).persisted ? "bfcache" : "new"));
    const hOrient = h("orientationchange", () => String((w as Window & { orientation?: number }).orientation ?? ""));
    const hPop = h("popstate");

    w.addEventListener("scroll", hScroll, { passive: true });
    w.addEventListener("resize", hResize);
    w.addEventListener("pageshow", hShow);
    w.addEventListener("orientationchange", hOrient);
    w.addEventListener("popstate", hPop);
    d.addEventListener("visibilitychange", hVis);
    d.addEventListener("focusin", hFocusIn);
    d.addEventListener("focusout", hFocusOut);
    vv?.addEventListener("scroll", hVvScroll);
    vv?.addEventListener("resize", hVvResize);

    const mo = new MutationObserver((recs) => {
      const isVp = (n: Node) => n instanceof HTMLMetaElement && n.name === "viewport";
      const vp = recs.some((r) =>
        isVp(r.target) || Array.from(r.addedNodes).some(isVp) || Array.from(r.removedNodes).some(isVp));
      log("head", vp ? "viewport meta!" : "mut");
      schedule();
    });
    mo.observe(d.head, { childList: true, subtree: true, attributes: true });

    update();
    const timer = setInterval(update, 250);
    return () => {
      clearInterval(timer);
      if (raf) cancelAnimationFrame(raf);
      w.removeEventListener("scroll", hScroll);
      w.removeEventListener("resize", hResize);
      w.removeEventListener("pageshow", hShow);
      w.removeEventListener("orientationchange", hOrient);
      w.removeEventListener("popstate", hPop);
      d.removeEventListener("visibilitychange", hVis);
      d.removeEventListener("focusin", hFocusIn);
      d.removeEventListener("focusout", hFocusOut);
      vv?.removeEventListener("scroll", hVvScroll);
      vv?.removeEventListener("resize", hVvResize);
      mo.disconnect();
    };
  }, []);

  return createPortal(
    <div
      data-rb-probe
      style={{
        position: "fixed", inset: 0, zIndex: 2147483000, pointerEvents: "none",
        border: "2px dashed #E879F9", boxSizing: "border-box",
        userSelect: "none", WebkitUserSelect: "none", direction: "ltr", textAlign: "left",
      }}
    >
      <span style={{ ...TAG, top: 2 }}>▼ FRAME TOP (fixed inset:0)</span>
      <span style={{ ...TAG, bottom: 2 }}>▲ FRAME BOTTOM</span>
      <div
        style={{
          position: "absolute", top: "40%", left: 2, right: 2,
          background: "rgba(0,0,0,0.74)", padding: "3px 4px", borderRadius: 6,
        }}
      >
        <div style={{ font: "700 10px/1.2 ui-monospace,Menlo,monospace", color: "#fff", marginBottom: 2 }}>
          <span style={{ background: "#DC2626", padding: "1px 5px", borderRadius: 3 }}>PROBE ON</span>
          <span style={{ color: "#A3A3A3", fontWeight: 400 }}> · 5 taps on logo = off</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...PRE, color: "#4ADE80", fontWeight: 700 }}>LIVE</div>
            <pre ref={liveRef} style={PRE} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...PRE, color: "#FBBF24", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
              <span>ONSET</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onset = null; episodes = 0; inAnomaly = false;
                  updateRef.current();
                }}
                style={{
                  pointerEvents: "auto", touchAction: "manipulation", cursor: "pointer",
                  font: "700 9px/1 ui-monospace,Menlo,monospace", color: "#000", background: "#FBBF24",
                  border: 0, borderRadius: 5, padding: "9px 11px",
                }}
              >
                RESET ONSET
              </button>
            </div>
            <pre ref={onsetRef} style={PRE} />
          </div>
        </div>
      </div>
      {/* safe-area sentinel: env() → padding so getComputedStyle can read it */}
      <div
        ref={sentinelRef}
        style={{
          position: "absolute", left: 0, top: 0, width: 0, height: 0, visibility: "hidden",
          paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)",
        }}
      />
    </div>,
    document.body
  );
}
