"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const BRAND = "#DC2626";

const NAV_MAIN = [
  { href: "/dashboard", label: "דשבורד",   icon: "⬡", iconColor: "#38BDF8" },
  { href: "/projects",  label: "פרויקטים", icon: "♫", iconColor: "#60A5FA" },
  { href: "/social",    label: "סושיאל",   icon: "📱", iconColor: "#EC4899" },
  { href: "/clients",   label: "לקוחות",   icon: "☆", iconColor: "#C084FC" },
  { href: "/tasks",     label: "משימות",   icon: "✓", iconColor: "#F59E0B" },
  { href: "/team",      label: "צוות",     icon: "👥", iconColor: "#A855F7" },
  { href: "/shows",     label: "הופעות",   icon: "🎤", iconColor: "#F472B6" },
  { href: "/red-films", label: "Red Films", icon: "🎬", iconColor: "#EC4899" },
  { href: "/finance",   label: "כספים",    icon: "₪",  iconColor: "#34D399" },
  { href: "/insights",  label: "תובנות",   icon: "◎", iconColor: "#2DD4BF" },
];

const NAV_SETTINGS = [
  { href: "/setup/calendar", label: "יומן",   icon: "📅", iconColor: "#64748B" },
  { href: "/setup/dropbox",  label: "Dropbox", icon: "📦", iconColor: "#64748B" },
  { href: "/setup/reports",  label: "דוחות",  icon: "📧", iconColor: "#64748B" },
];

function RRMark({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 60 60"
      fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0, filter: "drop-shadow(0 0 6px rgba(220,38,38,0.6))" }}
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

function NavLink({ href, label, icon, iconColor, pathname, badge }: {
  href: string; label: string; icon: string; iconColor?: string;
  pathname: string; badge?: number;
}) {
  const active = pathname === href || pathname.startsWith(href + "/");
  const color15 = iconColor ? `${iconColor}26` : "rgba(255,255,255,0.08)";

  return (
    <Link
      href={href}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "6px 10px 6px 12px",
        borderRadius: 10,
        background: active
          ? "linear-gradient(90deg, rgba(220,38,38,0.13) 0%, rgba(220,38,38,0.03) 100%)"
          : "transparent",
        border: active ? `1px solid rgba(220,38,38,0.18)` : "1px solid transparent",
        borderRight: active ? `3px solid ${BRAND}` : "3px solid transparent",
        color: active ? "#F0F0F0" : "#707070",
        fontSize: 13, fontWeight: active ? 600 : 400,
        textDecoration: "none",
        transition: "all 0.13s",
        direction: "rtl",
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        background: active ? "rgba(220,38,38,0.18)" : color15,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14,
        transition: "background 0.13s",
      }}>
        <span style={{ lineHeight: 1 }}>{icon}</span>
      </div>
      <span style={{ flex: 1 }}>{label}</span>
      {badge != null && badge > 0 && (
        <span style={{
          fontSize: 10, fontWeight: 700, color: "#141414",
          background: "#EF4444", borderRadius: 10,
          padding: "1px 6px", minWidth: 18, textAlign: "center", lineHeight: "16px",
        }}>
          {badge}
        </span>
      )}
    </Link>
  );
}

export default function Sidebar({ onOpenChat: _onOpenChat }: { onOpenChat?: () => void }) {
  const pathname = usePathname();
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [premium, setPremium] = useState(false);

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
    fetch("/api/agent/alerts?status=new&count=1")
      .then((r) => r.json())
      .then((d) => setUnreadAlerts(d.count ?? 0))
      .catch(() => {});
  }, []);

  return (
    <aside
      className="hidden md:flex flex-col sticky top-0 border-l"
      style={{ background: "#141414", borderColor: "#2A2A2A", width: 224, height: "100dvh" }}
    >
      {/* Logo */}
      <div style={{
        padding: "20px 16px 16px",
        borderBottom: "1px solid #222",
        display: "flex", alignItems: "center", gap: 10,
        direction: "rtl",
      }}>
        <RRMark size={36} />
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: "#F0F0F0", letterSpacing: "-0.01em" }}>
            Redbloods
          </div>
          <div style={{
            fontSize: 9, fontWeight: 700, color: BRAND,
            textTransform: "uppercase", letterSpacing: "0.18em",
            marginTop: 2,
          }}>
            Records
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto", direction: "rtl" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV_MAIN.map(({ href, label, icon, iconColor }) => (
            <NavLink
              key={href}
              href={href}
              label={label}
              icon={icon}
              iconColor={iconColor}
              pathname={pathname}
              badge={href === "/insights" ? unreadAlerts : undefined}
            />
          ))}
        </div>

        {/* Section divider */}
        <div style={{ margin: "14px 4px 6px", direction: "rtl" }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: "#3A3A3A",
            letterSpacing: "0.12em", textTransform: "uppercase",
            marginBottom: 6,
          }}>
            ניהול
          </div>
          <div style={{ height: 1, background: "#242424" }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 6 }}>
          {NAV_SETTINGS.map(({ href, label, icon, iconColor }) => (
            <NavLink key={href} href={href} label={label} icon={icon} iconColor={iconColor} pathname={pathname} />
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div style={{
        padding: "12px 12px 14px",
        borderTop: "1px solid #222",
        direction: "rtl",
      }}>
        {/* Admin row */}
        <div style={{
          display: "flex", alignItems: "center", gap: 9,
          marginBottom: 10,
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
            background: `linear-gradient(135deg, ${BRAND}, #991B1B)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 800, color: "#fff",
            boxShadow: `0 2px 8px rgba(220,38,38,0.4)`,
          }}>R</div>
          <div style={{ lineHeight: 1.3 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#D0D0D0" }}>Redbloods Admin</div>
            <div style={{ fontSize: 10, color: "#555" }}>מנהל מערכת</div>
          </div>
        </div>

        {/* STD/PRO toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 10, color: "#444" }}>גרסה 1.0 MVP</div>
          <button
            onClick={toggleSkin}
            title={premium ? "עבור לסקין ברירת מחדל" : "עבור לסקין Premium"}
            style={{
              fontSize: 11, padding: "3px 8px", borderRadius: 8, cursor: "pointer",
              border: `1px solid ${premium ? BRAND : "#333"}`,
              background: premium ? `rgba(220,38,38,0.15)` : "transparent",
              color: premium ? BRAND : "#555",
              fontWeight: 600,
            }}
          >
            {premium ? "PRO" : "STD"}
          </button>
        </div>
      </div>
    </aside>
  );
}
