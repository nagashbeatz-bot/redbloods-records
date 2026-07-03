"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAndRedirect } from "@/lib/supabase-browser";
import { type ClientRole } from "@/lib/use-role";
import { usePrivacyMode } from "@/lib/use-privacy";
import { useVictorT } from "@/lib/victor-i18n";

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
  { href: "/red-artists", label: "Red Artists", icon: "🎤", iconColor: "#DC2626" },
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

export default function Sidebar({ role, onOpenChat: _onOpenChat }: { role: ClientRole; onOpenChat?: () => void }) {
  const pathname = usePathname();
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [hoveredHref, setHoveredHref] = useState<string | null>(null);
  const [privacyHidden, togglePrivacy] = usePrivacyMode();

  // Victor's chrome follows his language (en/ru); owner stays Hebrew.
  const vt = useVictorT();
  const isVictor = role === "victor";

  // Friendly display name by role (no DB / no profiles system).
  const displayName = role === "owner" ? "NagashBeatz" : role === "victor" ? "Victor" : "Redbloods";
  const displaySub  = role === "owner" ? "מנהל מערכת" : isVictor ? vt("common.supplier") : "";

  // Full nav ONLY for owner; victor → minimal (his page); null/unknown → none.
  // role comes pre-hydrated from AppShell (cached before paint) so the owner's
  // nav stays stable across navigations and Victor never sees the full nav.
  const navMain =
    role === "owner"
      ? NAV_MAIN
      : role === "victor"
        ? [{ href: "/team/victor", label: "Victor", icon: "👤", iconColor: "#A855F7" }]
        : [];
  const navTools = role === "owner" ? NAV_TOOLS : [];

  useEffect(() => {
    // Keep applying any previously-saved skin; the toggle UI was removed.
    const stored = localStorage.getItem("rb_skin");
    document.documentElement.setAttribute("data-skin", stored === "premium" ? "premium" : "default");
  }, []);

  useEffect(() => {
    if (role !== "owner") return; // alerts are owner-only
    fetch("/api/agent/alerts?status=new&count=1")
      .then((r) => r.json())
      .then((d) => setUnreadAlerts(d.count ?? 0))
      .catch(() => {});
  }, [role]);

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
        }}>{role === "owner" ? "ראשי" : isVictor ? vt("nav.main") : ""}</div>

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

        {/* Section: כלים — owner only (hidden from Victor and while role loads) */}
        {role === "owner" && (
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
        )}
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
          <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</div>
          {displaySub && <div style={{ fontSize: 10, color: MUTED }}>{displaySub}</div>}
        </div>
        {/* Privacy / "מצב לקוח" toggle — owner only. Fixed 32×32, only colors
            change between states so the footer never resizes. */}
        {role === "owner" && (
          <button
            onClick={togglePrivacy}
            title={privacyHidden ? "מצב לקוח פעיל" : "הסתר כספים"}
            style={{
              width: 32, height: 32, flexShrink: 0, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", fontFamily: "inherit", fontSize: 14, lineHeight: 1,
              background: privacyHidden ? "rgba(234,179,8,0.14)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${privacyHidden ? "rgba(234,179,8,0.5)" : "rgba(255,255,255,0.1)"}`,
              color: privacyHidden ? "#EAB308" : SUB,
              boxShadow: privacyHidden ? "0 0 8px rgba(234,179,8,0.25)" : "none",
              transition: "color 0.15s, background 0.15s, box-shadow 0.15s, border-color 0.15s",
            }}
          >👁</button>
        )}
        <button
          onClick={signOutAndRedirect}
          title={isVictor ? vt("common.signOut") : "יציאה"}
          style={{
            fontSize: 9, padding: "2px 8px", borderRadius: 6, cursor: "pointer",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: SUB, fontWeight: 700, flexShrink: 0,
          }}
        >
          {isVictor ? vt("common.signOut") : "יציאה"}
        </button>
      </div>
    </aside>
  );
}
