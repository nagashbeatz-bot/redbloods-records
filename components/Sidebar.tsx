"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase-browser";

// Run before paint on the client (avoids nav flicker); no-op shape on the server.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
const ROLE_CACHE_KEY = "rb_role";

const BRAND   = "#DC2626";
const SUB     = "#A0A0A0";
const MUTED   = "#606060";
const DIM     = "#404040";
const TEXT    = "#F2F2F2";
const BORDER2 = "rgba(255,255,255,0.04)";

const NAV_MAIN = [
  { href: "/dashboard", label: "דשבורד",    icon: "⊞",  iconColor: "#38BDF8" },
  { href: "/projects",  label: "פרויקטים",  icon: "♫",  iconColor: "#60A5FA" },
  { href: "/social",    label: "סושיאל",    icon: "📱", iconColor: "#EC4899" },
  { href: "/clients",   label: "לקוחות",    icon: "☆",  iconColor: "#C084FC" },
  { href: "/tasks",     label: "משימות",    icon: "✓",  iconColor: "#F59E0B" },
  { href: "/team",      label: "צוות",      icon: "👥", iconColor: "#A855F7" },
  { href: "/shows",     label: "הופעות",    icon: "🎤", iconColor: "#F472B6" },
  { href: "/red-films", label: "Red Films", icon: "🎬", iconColor: "#EC4899" },
  { href: "/finance",   label: "כספים",     icon: "₪",  iconColor: "#34D399" },
  { href: "/insights",  label: "תובנות",    icon: "◎",  iconColor: "#2DD4BF" },
];

const NAV_TOOLS = [
  { href: "/setup/calendar", label: "יומן",    icon: "📅" },
  { href: "/setup/dropbox",  label: "Dropbox", icon: "📦" },
  { href: "/setup/reports",  label: "דוחות",   icon: "📧" },
];

function RRMark({ size = 64 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 60 60"
      fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0, filter: "drop-shadow(0 0 10px rgba(220,38,38,0.7)) drop-shadow(0 0 24px rgba(220,38,38,0.35))" }}
    >
      <line x1="8"  y1="12" x2="8"  y2="48" stroke={BRAND} strokeWidth="3.5" strokeLinecap="round"/>
      <path d="M8 12 Q8 12 18 12 Q26 12 26 20 Q26 28 18 28 L8 28" stroke={BRAND} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <line x1="17" y1="28" x2="27" y2="48" stroke={BRAND} strokeWidth="3" strokeLinecap="round"/>
      <line x1="33" y1="12" x2="33" y2="48" stroke={BRAND} strokeWidth="3.5" strokeLinecap="round"/>
      <path d="M33 12 Q33 12 43 12 Q51 12 51 20 Q51 28 43 28 L33 28" stroke={BRAND} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <line x1="42" y1="28" x2="52" y2="48" stroke={BRAND} strokeWidth="3" strokeLinecap="round"/>
    </svg>
  );
}

function NavLink({ href, label, icon, iconColor, pathname, badge, hoveredHref, onMouseEnter, onMouseLeave }: {
  href: string; label: string; icon: string; iconColor?: string;
  pathname: string; badge?: number;
  hoveredHref: string | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const active = pathname === href || pathname.startsWith(href + "/");
  const visualActive = hoveredHref === href || (!hoveredHref && active);
  const color15 = iconColor ? `${iconColor}15` : "rgba(255,255,255,0.06)";

  return (
    <Link
      href={href}
      style={{
        position: "relative", borderRadius: 10, overflow: "hidden",
        display: "block", textDecoration: "none",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {active && (
        <div style={{
          position: "absolute", top: 0, bottom: 0, left: 0, width: 3,
          background: BRAND, borderRadius: "0 2px 2px 0",
        }} />
      )}
      <div style={{
        display: "flex", alignItems: "center", gap: 11,
        padding: "10px 12px 10px 14px",
        background: visualActive
          ? "linear-gradient(90deg,rgba(220,38,38,0.13),rgba(220,38,38,0.03))"
          : "transparent",
        border: `1px solid ${visualActive ? "rgba(220,38,38,0.2)" : "transparent"}`,
        borderRadius: 10, cursor: "pointer",
        color: visualActive ? BRAND : SUB,
        fontSize: 13.5, fontWeight: visualActive ? 700 : 500,
        transition: "background 0.15s, border-color 0.15s, color 0.15s",
      }}>
        <span style={{
          width: 27, height: 27, borderRadius: 8, flexShrink: 0,
          background: visualActive ? "rgba(220,38,38,0.18)" : color15,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, color: visualActive ? BRAND : (iconColor ?? SUB),
          transition: "background 0.15s, color 0.15s",
        }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        {badge != null && badge > 0 && (
          <span style={{
            fontSize: 9, fontWeight: 800, background: BRAND, color: "#fff",
            borderRadius: 99, padding: "2px 7px",
            boxShadow: "0 0 6px rgba(220,38,38,0.5)",
          }}>{badge}</span>
        )}
      </div>
    </Link>
  );
}

export default function Sidebar({ onOpenChat: _onOpenChat }: { onOpenChat?: () => void }) {
  const pathname = usePathname();
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [premium, setPremium] = useState(false);
  const [hoveredHref, setHoveredHref] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<"owner" | "victor" | null>(null);

  // Hydrate the last-known role from cache BEFORE paint. AppShell remounts on
  // every navigation, so without this the owner's full nav would blink away to
  // empty each time until /api/me resolves. Only a cached "owner"/"victor" is
  // trusted to render nav while the request is in flight.
  useIsoLayoutEffect(() => {
    try {
      const cached = localStorage.getItem(ROLE_CACHE_KEY);
      if (cached === "owner" || cached === "victor") setMyRole(cached);
    } catch { /* ignore */ }
  }, []);

  // Confirm/refresh role from the server; cache it, or clear on unknown/denied
  // (so a stale owner cache can never linger after switching users).
  useEffect(() => {
    let alive = true;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : { role: "denied" }))
      .then((d) => {
        if (!alive) return;
        if (d?.role === "owner" || d?.role === "victor") {
          setMyRole(d.role);
          try { localStorage.setItem(ROLE_CACHE_KEY, d.role); } catch { /* ignore */ }
        } else {
          setMyRole(null);
          try { localStorage.removeItem(ROLE_CACHE_KEY); } catch { /* ignore */ }
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  // Full nav ONLY once we know the user is an owner. While role is loading (null)
  // or unknown, show no main nav — prevents a flash of the full Sidebar for Victor
  // before /api/me resolves. Victor → minimal (his page only).
  const navMain =
    myRole === "owner"
      ? NAV_MAIN
      : myRole === "victor"
        ? [{ href: "/team/victor", label: "Victor", icon: "👤", iconColor: "#A855F7" }]
        : [];
  const navTools = myRole === "owner" ? NAV_TOOLS : [];

  useEffect(() => {
    const stored = localStorage.getItem("rb_skin");
    const isPremium = stored === "premium";
    setPremium(isPremium);
    document.documentElement.setAttribute("data-skin", isPremium ? "premium" : "default");
  }, []);

  function toggleSkin() {
    const next = !premium;
    setPremium(next);
    const val = next ? "premium" : "default";
    localStorage.setItem("rb_skin", val);
    document.documentElement.setAttribute("data-skin", val);
  }

  useEffect(() => {
    if (myRole !== "owner") return; // alerts are owner-only
    fetch("/api/agent/alerts?status=new&count=1")
      .then((r) => r.json())
      .then((d) => setUnreadAlerts(d.count ?? 0))
      .catch(() => {});
  }, [myRole]);

  return (
    <aside
      className="hidden md:flex flex-col sticky top-0 border-l"
      style={{ background: "#141414", borderColor: "#2A2A2A", width: 248, height: "100dvh" }}
    >
      {/* Logo — centered, gradient bg */}
      <div style={{
        padding: "24px 20px 22px",
        borderBottom: `1px solid ${BORDER2}`,
        background: "linear-gradient(180deg, rgba(220,38,38,0.07) 0%, rgba(220,38,38,0.01) 100%)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <RRMark size={64} />
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{
            fontSize: 19, fontWeight: 900, color: "#FFFFFF",
            letterSpacing: "-0.01em", lineHeight: 1.15,
            textShadow: "0 1px 8px rgba(0,0,0,0.5)",
          }}>Redbloods</div>
          <div style={{
            fontSize: 12, fontWeight: 800, color: BRAND,
            letterSpacing: "0.26em", textTransform: "uppercase",
            marginTop: 3, textShadow: "0 0 12px rgba(220,38,38,0.5)",
          }}>Records</div>
        </div>
      </div>

      {/* Nav */}
      <div style={{ padding: "16px 12px 6px", flex: 1, overflowY: "auto" }}>
        {/* Section label: ראשי */}
        <div style={{
          fontSize: 9, fontWeight: 800, color: DIM,
          letterSpacing: "0.1em", textTransform: "uppercase",
          padding: "0 8px 10px",
        }}>ראשי</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {navMain.map(({ href, label, icon, iconColor }) => (
            <NavLink
              key={href}
              href={href}
              label={label}
              icon={icon}
              iconColor={iconColor}
              pathname={pathname}
              badge={href === "/insights" ? unreadAlerts : undefined}
              hoveredHref={hoveredHref}
              onMouseEnter={() => setHoveredHref(href)}
              onMouseLeave={() => setHoveredHref(null)}
            />
          ))}
        </div>

        {/* Section label: כלים */}
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 1, background: BORDER2, margin: "0 4px 12px" }} />
          <div style={{
            fontSize: 9, fontWeight: 800, color: DIM,
            letterSpacing: "0.1em", textTransform: "uppercase",
            padding: "0 8px 10px",
          }}>כלים</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {navTools.map(({ href, label, icon }) => (
              <Link key={href} href={href} style={{
                display: "flex", alignItems: "center", gap: 11,
                padding: "9px 12px 9px 14px", borderRadius: 10,
                color: MUTED, fontSize: 13.5, fontWeight: 500, cursor: "pointer",
                textDecoration: "none",
              }}>
                <span style={{ fontSize: 14, width: 27, textAlign: "center" }}>{icon}</span>
                <span style={{ flex: 1 }}>{label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: "14px 16px 18px",
        borderTop: `1px solid ${BORDER2}`,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        {/* Gray avatar — like dashboard */}
        <div style={{
          width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
          background: "linear-gradient(135deg,#2A2A2A,#1A1A1A)",
          border: "1px solid rgba(255,255,255,0.1)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 700, color: SUB,
        }}>RB</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Redbloods Admin</div>
          <div style={{ fontSize: 10, color: MUTED }}>מנהל מערכת</div>
        </div>
        <button
          onClick={toggleSkin}
          title={premium ? "עבור לסקין ברירת מחדל" : "עבור לסקין Premium"}
          style={{
            fontSize: 9, padding: "2px 8px", borderRadius: 6, cursor: "pointer",
            background: `rgba(220,38,38,0.15)`,
            border: `1px solid rgba(220,38,38,0.3)`,
            color: BRAND, fontWeight: 900, letterSpacing: "0.04em",
            flexShrink: 0,
          }}
        >
          {premium ? "PRO" : "STD"}
        </button>
        <button
          onClick={async () => {
            try { localStorage.removeItem(ROLE_CACHE_KEY); } catch { /* ignore */ }
            try { await createSupabaseBrowser().auth.signOut(); } catch { /* ignore */ }
            window.location.href = "/login";
          }}
          title="יציאה"
          style={{
            fontSize: 9, padding: "2px 8px", borderRadius: 6, cursor: "pointer",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: SUB, fontWeight: 700, flexShrink: 0,
          }}
        >
          יציאה
        </button>
      </div>
    </aside>
  );
}
