"use client";

// ── Global header notifications bell + dropdown ────────────────────────────
// Wired to the signed-in user's real push history via GET /api/notifications
// (read-only; never sends a push and never calls /api/push/check). Privacy +
// scoping are enforced server-side by RLS — React never filters for security.
//
// Rendered by AppShell for the owner AND for Victor. Each of them only ever
// sees their own rows: every handler under /api/notifications scopes to
// recipient_user_id = the session user, so this component needs no role logic
// to keep the two apart. What the role DOES decide here is language — see
// `lang` below.

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";
import { useRole } from "@/lib/use-role";
import { syncAppBadge } from "@/lib/app-badge";
import { victorT, useVictorLang, type VictorLang } from "@/lib/victor-i18n";

// ── API shape (mirrors GET /api/notifications) ─────────────────────────────
interface ApiNotification {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  tag: string | null;
  projectId: string | null;
  entityType: string | null;
  entityId: string | null;
  actorName: string | null;
  recipientRole: string | null;
  createdAt: string;
  readAt: string | null;
}

// ── Icon "kind" (derived from tag/entityType — the API carries no type field) ──
type NotifKind = "warning" | "deadline" | "session" | "file" | "followup" | "version" | "payment" | "victor" | "default";

const KIND_STYLE: Record<NotifKind, { color: string; bg: string }> = {
  warning:  { color: "#EF4444", bg: "rgba(239,68,68,0.12)"  },
  deadline: { color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  session:  { color: "#3B82F6", bg: "rgba(59,130,246,0.12)" },
  file:     { color: "#06B6D4", bg: "rgba(6,182,212,0.12)"  },
  followup: { color: "#10B981", bg: "rgba(16,185,129,0.12)" },
  version:  { color: "#A855F7", bg: "rgba(168,85,247,0.12)" },
  payment:  { color: "#10B981", bg: "rgba(16,185,129,0.12)" },
  victor:   { color: "#A855F7", bg: "rgba(168,85,247,0.12)" },
  default:  { color: "#8A8A8A", bg: "rgba(255,255,255,0.06)" },
};

function kindOf(n: ApiNotification): NotifKind {
  const et  = (n.entityType ?? "").toLowerCase();
  const tag = (n.tag ?? "").toLowerCase();
  if (et === "project") return "session";
  if (et === "sound_engineer_work" || et === "victor_work") return "version";
  if (et === "transaction" || tag.includes("payment")) return "payment";
  if (et === "session" || tag.includes("session")) return "session";
  if (et === "task" || tag.includes("followup") || tag.includes("notes")) return "followup";
  if (tag.includes("upload") || tag.includes("file")) return "file";
  if (tag.includes("deadline") || tag.includes("overdue") || tag.includes("due")) return "deadline";
  if (tag.includes("visit") || tag.includes("login")) return "victor";
  if (tag.includes("victor") || tag.includes("mix-ready") || tag.includes("work")) return "version";
  return "default";
}

// ── Relative time (no date library — plain JS), localized per bell language ──
// he/en only need one/other, so they collapse to .one/.many; ru needs all three
// Slavic forms, which is what the .one/.few/.many keys carry.
function pluralForm(lang: VictorLang, n: number): "one" | "few" | "many" {
  if (lang !== "ru") return n === 1 ? "one" : "many";
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "one";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "few";
  return "many";
}

function relTime(iso: string, lang: VictorLang): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "";
  const ago = (unit: "min" | "hour" | "day", n: number) =>
    victorT(lang, `bell.time.${unit}.${pluralForm(lang, n)}`, { n });
  const min = Math.floor((Date.now() - then) / 60000);
  if (min < 1)  return victorT(lang, "bell.time.now");
  if (min < 60) return ago("min", min);
  const hr = Math.floor(min / 60);
  if (hr < 24)  return ago("hour", hr);
  const day = Math.floor(hr / 24);
  if (day === 1) return victorT(lang, "bell.time.yesterday");
  return ago("day", day);
}

// ── URL safety: only internal, absolute paths — never external / scheme ────
function isSafeInternalUrl(u: string | null): u is string {
  if (!u || typeof u !== "string") return false;
  if (!u.startsWith("/")) return false;  // must be an internal path
  if (u.startsWith("//")) return false;  // protocol-relative → external
  if (u.includes("\\")) return false;    // backslash trickery
  return true;
}

// ── Shared in-flight dedup ─────────────────────────────────────────────────
// AppShell renders the bell in BOTH the mobile and desktop headers (one hidden
// by CSS). Two instances mount → this collapses their concurrent mount fetch
// into a single network request. No caching beyond the in-flight window.
let _inflight: Promise<{ notifications: ApiNotification[]; unreadCount: number }> | null = null;
async function loadNotifications(): Promise<{ notifications: ApiNotification[]; unreadCount: number }> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch("/api/notifications", { headers: { "cache-control": "no-store" } });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      return {
        notifications: Array.isArray(data.notifications) ? (data.notifications as ApiNotification[]) : [],
        unreadCount: typeof data.unreadCount === "number" ? data.unreadCount : 0,
      };
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

// ── Icons (inline SVG, currentColor) ───────────────────────────────────────
const ic = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function BellIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ic}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function CheckIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ic}>
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

function KindIcon({ kind, size = 17 }: { kind: NotifKind; size?: number }) {
  switch (kind) {
    case "warning":
      return (<svg width={size} height={size} viewBox="0 0 24 24" {...ic}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>);
    case "deadline":
      return (<svg width={size} height={size} viewBox="0 0 24 24" {...ic}><path d="M5 22h14" /><path d="M5 2h14" /><path d="M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22" /><path d="M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4A2 2 0 0 0 17 6.2V2" /></svg>);
    case "session":
      return (<svg width={size} height={size} viewBox="0 0 24 24" {...ic}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></svg>);
    case "file":
      return (<svg width={size} height={size} viewBox="0 0 24 24" {...ic}><path d="M12 13v8" /><path d="m8 17 4-4 4 4" /><path d="M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.2" /></svg>);
    case "followup":
      return (<svg width={size} height={size} viewBox="0 0 24 24" {...ic}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></svg>);
    case "version":
      return (<svg width={size} height={size} viewBox="0 0 24 24" {...ic}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>);
    case "payment":
      return (<svg width={size} height={size} viewBox="0 0 24 24" {...ic}><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1" /><path d="m9 11 3 3L22 4" /></svg>);
    case "victor":
      return (<svg width={size} height={size} viewBox="0 0 24 24" {...ic}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>);
    default:
      return <BellIcon size={size} />;
  }
}

// ── Panel geometry ─────────────────────────────────────────────────────────
const PANEL_W = 344;
interface PanelPos { top: number; left: number; width: number; }

export default function NotificationsBell() {
  const [open, setOpen]               = useState(false);
  const [tab, setTab]                 = useState<"all" | "unread">("all");
  const [mounted, setMounted]         = useState(false);
  const [pos, setPos]                 = useState<PanelPos | null>(null);
  const [items, setItems]             = useState<ApiNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [status, setStatus]           = useState<"loading" | "ready" | "error">("loading");
  const [actionError, setActionError] = useState<string | null>(null);
  const [markingAll, setMarkingAll]   = useState(false);
  const [justReadIds, setJustReadIds] = useState<Set<string>>(new Set()); // brief fade cue only
  const btnRef = useRef<HTMLButtonElement>(null);

  const router = useRouter();
  const { openProject } = useGlobalProjectDrawer();
  const role = useRole();

  // Language follows the ROLE, never the persisted Victor language on its own:
  // Victor reads en/ru (his portal is never Hebrew), Steven is English-only (his
  // page hardcodes it and offers no toggle), everyone else — the owner — stays
  // Hebrew. Reading useVictorLang() directly would flip the OWNER's bell to
  // English the moment they switched Victor's page language while viewing it.
  const [victorLang] = useVictorLang();
  const lang: VictorLang =
    role === "victor" ? (victorLang === "ru" ? "ru" : "en") :
    role === "steven" ? "en" :
    "he";
  const t = (key: string, vars?: Record<string, string | number>) => victorT(lang, key, vars);

  useEffect(() => setMounted(true), []);

  // ── App Icon Badge sync ───────────────────────────────────────────────
  // Mirrors the SAME unreadCount this bell already tracks — no separate count
  // logic. Deliberately NOT gated on role: AppShell decides who gets a bell
  // (canSeeBell), and unreadCount is by construction the session user's own
  // count, so a second role list here could only drift out of sync with the
  // first — which is exactly what happened when the bell grew past the owner.
  // Foreground-only; the service worker (public/sw.js) updates the badge on
  // push arrival so it also works while the app is closed.
  useEffect(() => {
    syncAppBadge(unreadCount);
  }, [unreadCount]);

  // ── Fetch (read-only). Mount → badge; open → refresh. No polling/realtime. ──
  const refresh = useCallback(async () => {
    setStatus((s) => (items.length === 0 ? "loading" : s));
    try {
      const data = await loadNotifications();
      setItems(data.notifications);
      setUnreadCount(data.unreadCount);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) { setActionError(null); refresh(); } // controlled refresh on open only
  };

  // ── Shared "mark one as read" — used by both the row click (which also
  // navigates) and the standalone ✓ button (which never navigates). Same
  // PATCH, same optimistic state update, same decrement — one code path. ──
  const markRead = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/notifications/${id}`, { method: "PATCH" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const readAt = data.readAt ?? new Date().toISOString();
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, readAt } : x)));
      setUnreadCount((c) => Math.max(0, c - 1)); // decrement exactly once
      setJustReadIds((prev) => new Set(prev).add(id)); // brief fade cue
      setTimeout(() => {
        setJustReadIds((prev) => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next; });
      }, 350);
      return true;
    } catch {
      // victorT(lang, ...) rather than t(...): t is a fresh closure every render,
      // so capturing it in this memo would freeze the language at first paint —
      // before /api/me has resolved Victor's role.
      setActionError(victorT(lang, "bell.markReadError"));
      return false;
    }
  }, [lang]);

  // ── Mark one read on click, then navigate ──
  const onRowClick = async (n: ApiNotification) => {
    setActionError(null);
    if (!n.readAt) {
      const ok = await markRead(n.id);
      if (!ok) return; // do NOT navigate on failure
    }
    // Navigation: project drawer → internal url → display-only (no wrong nav).
    if (n.projectId) { openProject(n.projectId); setOpen(false); return; }
    if (isSafeInternalUrl(n.url)) { router.push(n.url); setOpen(false); return; }
    // display-only: nothing to navigate to → leave the dropdown open.
  };

  // ── Mark-as-read ✓ button — read-only action: never opens/navigates, never
  // closes the dropdown. Already-read is a no-op (button is inert). ──
  const onMarkReadClick = (n: ApiNotification) => {
    if (n.readAt) return;
    setActionError(null);
    void markRead(n.id);
  };

  // ── Mark all read ──
  const onMarkAll = async () => {
    if (markingAll || unreadCount === 0) return;
    setMarkingAll(true);
    setActionError(null);
    try {
      const res = await fetch("/api/notifications/read-all", { method: "PATCH" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const readAt = data.readAt ?? new Date().toISOString();
      setItems((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt })));
      setUnreadCount(0);
    } catch {
      setActionError(t("bell.markAllError"));
    } finally {
      setMarkingAll(false);
    }
  };

  const shown = tab === "unread" ? items.filter((n) => !n.readAt) : items;
  const badge = unreadCount > 99 ? "99+" : String(unreadCount);

  // Position the panel under the bell, clamped to the viewport.
  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const isMobile = window.innerWidth < 768;
    const width = isMobile ? Math.min(PANEL_W, window.innerWidth - 24) : PANEL_W;
    let left = r.left + r.width / 2 - width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    setPos({ top: r.bottom + 8, left, width });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, place]);

  return (
    <>
      {/* ── Bell button (sits next to LISTEN) ── */}
      <button
        ref={btnRef}
        onClick={toggleOpen}
        title={t("bell.title")}
        aria-label={t("bell.title")}
        className="rb-bell-btn"
        style={{
          position: "relative",
          width: 34, height: 34, borderRadius: "50%",
          flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: open ? "rgba(220,38,38,0.12)" : "#161616",
          border: `1px solid ${open ? "rgba(220,38,38,0.45)" : "#242424"}`,
          color: open ? "#EF4444" : "#9A9A9A",
          cursor: "pointer",
          transition: "background 0.15s, border-color 0.15s, color 0.15s",
          fontFamily: "inherit",
        }}
        onMouseEnter={(e) => {
          if (open) return;
          e.currentTarget.style.background = "#1E1E1E";
          e.currentTarget.style.borderColor = "#333";
          e.currentTarget.style.color = "#CFCFCF";
        }}
        onMouseLeave={(e) => {
          if (open) return;
          e.currentTarget.style.background = "#161616";
          e.currentTarget.style.borderColor = "#242424";
          e.currentTarget.style.color = "#9A9A9A";
        }}
      >
        <BellIcon size={18} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute", top: -4, right: -4,
              minWidth: 17, height: 17, padding: "0 4px",
              borderRadius: 9,
              background: "#DC2626",
              border: "2px solid #141414",   // matches the header bg, so it reads as a cutout
              color: "#fff", fontSize: 10, fontWeight: 800, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 8px rgba(220,38,38,0.6)",
            }}
          >
            {badge}
          </span>
        )}
      </button>

      {/* ── Dropdown (portal — avoids header/main overflow clipping) ── */}
      {mounted && open && pos && createPortal(
        <>
          {/* click-outside backdrop (transparent) */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 9997, background: "transparent" }}
          />
          <div
            dir={lang === "he" ? "rtl" : "ltr"}
            role="dialog"
            aria-label={t("bell.title")}
            style={{
              position: "fixed",
              top: pos.top, left: pos.left, width: pos.width,
              maxHeight: "min(70vh, 560px)",
              zIndex: 9998,
              display: "flex", flexDirection: "column",
              background: "#181818",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 18,
              boxShadow: "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)",
              overflow: "hidden",
              fontFamily: "'Heebo', Arial, sans-serif",
            }}
          >
            {/* Header: title + "mark all read" + filter tabs */}
            <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11, minHeight: 18 }}>
                <span style={{ fontSize: 15, fontWeight: 900, color: "#F2F2F2", letterSpacing: "-0.01em" }}>{t("bell.title")}</span>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAll}
                    disabled={markingAll}
                    style={{
                      background: "none", border: "none", padding: 0,
                      fontSize: 11.5, fontWeight: 600, fontFamily: "inherit",
                      color: markingAll ? "#555" : "#7C7C7C",
                      cursor: markingAll ? "default" : "pointer",
                      transition: "color 0.15s",
                    }}
                    onMouseEnter={(e) => { if (!markingAll) e.currentTarget.style.color = "#C0C0C0"; }}
                    onMouseLeave={(e) => { if (!markingAll) e.currentTarget.style.color = "#7C7C7C"; }}
                  >
                    {t("bell.markAll")}
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <FilterPill label={t("bell.tabAll")}    active={tab === "all"}    onClick={() => setTab("all")} />
                <FilterPill label={t("bell.tabUnread")} active={tab === "unread"} onClick={() => setTab("unread")} count={unreadCount} />
              </div>
            </div>

            {/* List */}
            <div style={{ overflowY: "auto", flex: 1, minHeight: 120 }}>
              {status === "loading" && items.length === 0 ? (
                <div style={{ padding: "44px 16px", textAlign: "center", color: "#606060", fontSize: 13 }}>{t("bell.loading")}</div>
              ) : status === "error" && items.length === 0 ? (
                <div style={{ padding: "34px 16px", textAlign: "center" }}>
                  <div style={{ color: "#8C8C8C", fontSize: 13, marginBottom: 12 }}>{t("bell.loadError")}</div>
                  <button
                    type="button"
                    onClick={refresh}
                    style={{
                      background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 9, padding: "6px 16px", color: "#D0D0D0",
                      fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                    }}
                  >
                    {t("bell.retry")}
                  </button>
                </div>
              ) : shown.length === 0 ? (
                <div style={{ padding: "44px 16px", textAlign: "center", color: "#606060", fontSize: 13 }}>
                  {tab === "unread" ? t("bell.emptyUnread") : t("bell.emptyAll")}
                </div>
              ) : (
                shown.map((n) => (
                  <NotificationRow
                    key={n.id}
                    n={n}
                    lang={lang}
                    onClick={() => onRowClick(n)}
                    onMarkRead={() => onMarkReadClick(n)}
                    justRead={justReadIds.has(n.id)}
                  />
                ))
              )}
            </div>

            {/* Subtle action error (never closes the panel) */}
            {actionError && (
              <div style={{
                flexShrink: 0, padding: "8px 16px", fontSize: 11.5, fontWeight: 600,
                color: "#FCA5A5", background: "rgba(239,68,68,0.08)",
                borderTop: "1px solid rgba(239,68,68,0.16)", textAlign: "center",
              }}>
                {actionError}
              </div>
            )}

            {/* Footer (visual only — no full notifications page yet) */}
            <div
              className="rb-bell-footer"
              style={{
                flexShrink: 0,
                width: "100%",
                padding: "12px 16px",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                color: "#9A9A9A", fontSize: 12.5, fontWeight: 600,
                fontFamily: "inherit", textAlign: "center",
              }}
            >
              {t("bell.footer")}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

// ── Filter pill ────────────────────────────────────────────────────────────
function FilterPill({ label, active, onClick, count }: { label: string; active: boolean; onClick: () => void; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "5px 13px", borderRadius: 99,
        fontSize: 12, fontWeight: 700, fontFamily: "inherit",
        cursor: "pointer",
        background: active ? "rgba(220,38,38,0.12)" : "transparent",
        border: `1px solid ${active ? "rgba(220,38,38,0.5)" : "rgba(255,255,255,0.10)"}`,
        color: active ? "#F87171" : "#8A8A8A",
        transition: "all 0.15s",
      }}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; e.currentTarget.style.color = "#C0C0C0"; } }}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)"; e.currentTarget.style.color = "#8A8A8A"; } }}
    >
      {count != null && (
        <span style={{
          minWidth: 16, height: 16, padding: "0 4px", borderRadius: 8,
          background: active ? "rgba(220,38,38,0.35)" : "rgba(255,255,255,0.10)",
          color: active ? "#FCA5A5" : "#B0B0B0",
          fontSize: 10, fontWeight: 800, lineHeight: 1,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>{count > 99 ? "99+" : count}</span>
      )}
      {label}
    </button>
  );
}

// ── One notification row ───────────────────────────────────────────────────
function NotificationRow({
  n, lang, onClick, onMarkRead, justRead,
}: {
  n: ApiNotification; lang: VictorLang; onClick: () => void; onMarkRead: () => void; justRead: boolean;
}) {
  const kind = kindOf(n);
  const ts = KIND_STYLE[kind];
  const unread = !n.readAt;
  return (
    <div
      className="rb-bell-row"
      onClick={onClick}
      style={{
        position: "relative",
        display: "flex", alignItems: "flex-start", gap: 12,
        padding: "13px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        background: unread ? "rgba(255,255,255,0.015)" : "transparent",
        cursor: "pointer",
        opacity: justRead ? 0.4 : 1, // short fade cue when marked read — never affects layout
        transition: "background 0.13s, opacity 0.32s ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = unread ? "rgba(255,255,255,0.015)" : "transparent"; }}
    >
      {/* Text (right-aligned in RTL) */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {unread && (
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#DC2626", flexShrink: 0, boxShadow: "0 0 5px rgba(220,38,38,0.7)" }} />
          )}
          <span style={{
            fontSize: 13.5, fontWeight: unread ? 800 : 700, color: unread ? "#F2F2F2" : "#C8C8C8",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{n.title}</span>
        </div>
        {n.body && (
          <div style={{ fontSize: 12, color: "#8C8C8C", marginTop: 3, lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {n.body}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: "#585858", marginTop: 5 }}>{relTime(n.createdAt, lang)}</div>
      </div>

      {/* Icon (left in RTL) */}
      <div style={{
        width: 36, height: 36, borderRadius: 11, flexShrink: 0,
        background: ts.bg, color: ts.color,
        border: `1px solid ${ts.color}33`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <KindIcon kind={kind} />
      </div>

      {/* Mark-as-read ✓ (leftmost — never opens/navigates, never closes the
          panel; already-read renders checked/gray and is inert). */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onMarkRead(); }}
        disabled={!unread}
        title={victorT(lang, unread ? "bell.markRead" : "bell.read")}
        aria-label={victorT(lang, unread ? "bell.markRead" : "bell.read")}
        aria-pressed={!unread}
        style={{
          width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
          marginTop: 2,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 0, fontFamily: "inherit",
          border: `1.5px solid ${unread ? "rgba(255,255,255,0.22)" : "rgba(16,185,129,0.5)"}`,
          background: unread ? "transparent" : "rgba(16,185,129,0.14)",
          color: unread ? "#6E6E6E" : "#10B981",
          cursor: unread ? "pointer" : "default",
          transition: "background 0.15s, border-color 0.15s, color 0.15s",
        }}
        onMouseEnter={(e) => {
          if (!unread) return;
          e.currentTarget.style.borderColor = "rgba(16,185,129,0.6)";
          e.currentTarget.style.color = "#10B981";
        }}
        onMouseLeave={(e) => {
          if (!unread) return;
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.22)";
          e.currentTarget.style.color = "#6E6E6E";
        }}
      >
        <CheckIcon size={13} />
      </button>
    </div>
  );
}
