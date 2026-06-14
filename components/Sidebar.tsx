"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_MAIN = [
  { href: "/dashboard", label: "דשבורד",   icon: "⬡", iconColor: "#38BDF8" },
  { href: "/projects",  label: "פרויקטים", icon: "♫", iconColor: "#60A5FA" },
  { href: "/clients",   label: "לקוחות",   icon: "☆", iconColor: "#C084FC" },
  { href: "/tasks",     label: "משימות",   icon: "✓", iconColor: "#F59E0B" },
  { href: "/team",      label: "צוות",     icon: "👥", iconColor: "#A855F7" },
  { href: "/shows",     label: "הופעות",   icon: "🎤", iconColor: "#F472B6" },
  { href: "/red-films", label: "Red Films", icon: "🎬", iconColor: "#EC4899" },
  { href: "/finance",   label: "כספים",    icon: "₪",  iconColor: "#34D399" },
  { href: "/insights",  label: "תובנות",   icon: "◎", iconColor: "#2DD4BF" },
];

const NAV_SETTINGS = [
  { href: "/setup/calendar", label: "יומן",   icon: "📅", iconColor: undefined },
  { href: "/setup/dropbox",  label: "Dropbox", icon: "📦", iconColor: undefined },
  { href: "/setup/reports",  label: "דוחות",  icon: "📧", iconColor: undefined },
];

function NavLink({ href, label, icon, iconColor, pathname, badge, premium }: {
  href: string; label: string; icon: string; iconColor?: string;
  pathname: string; badge?: number; premium?: boolean;
}) {
  const active = pathname === href || pathname.startsWith(href + "/");
  const accentColor = premium ? "#6366F1" : "#3B82F6";
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
      style={{
        background: active ? `rgba(${premium ? "99,102,241" : "59,130,246"},0.15)` : "transparent",
        color: active ? accentColor : "#888",
        borderColor: active ? `rgba(${premium ? "99,102,241" : "59,130,246"},0.3)` : "transparent",
        border: "1px solid",
      }}
    >
      <span className="text-base" style={iconColor ? { color: iconColor, opacity: active ? 1 : 0.85 } : undefined}>
        {icon}
      </span>
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
      <div className="px-5 py-6 border-b" style={{ borderColor: "#2A2A2A" }}>
        {premium ? (
          <div>
            <div style={{
              fontSize: 11, fontWeight: 800, letterSpacing: "0.15em",
              color: "#6366F1", textTransform: "uppercase",
            }}>REDBLOODS OS</div>
            <div style={{ fontSize: 10, color: "#444", marginTop: 1 }}>ניהול הפקות</div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
              style={{ background: "linear-gradient(135deg, #EC4899, #3B82F6)" }}
            >
              RB
            </div>
            <div>
              <div className="text-sm font-bold" style={{ color: "#F0F0F0" }}>Redbloods</div>
              <div className="text-xs" style={{ color: "#888" }}>Records</div>
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="space-y-1">
          {NAV_MAIN.map(({ href, label, icon, iconColor }) => (
            <NavLink
              key={href}
              href={href}
              label={label}
              icon={icon}
              iconColor={iconColor}
              pathname={pathname}
              badge={href === "/insights" ? unreadAlerts : undefined}
              premium={premium}
            />
          ))}
        </div>
        <div className="mt-5 mb-2 px-3" style={{ fontSize: 10, fontWeight: 700, color: "#4A4A4A", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          ניהול
        </div>
        <div style={{ height: 1, background: "#282828", marginBottom: 8 }} />
        <div className="space-y-1">
          {NAV_SETTINGS.map(({ href, label, icon, iconColor }) => (
            <NavLink key={href} href={href} label={label} icon={icon} iconColor={iconColor} pathname={pathname} premium={premium} />
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t" style={{ borderColor: "#2A2A2A" }}>
        <div className="flex items-center justify-between">
          <div className="text-xs" style={{ color: "#555" }}>גרסה 1.0 MVP</div>
          <button
            onClick={toggleSkin}
            title={premium ? "עבור לסקין ברירת מחדל" : "עבור לסקין Premium"}
            style={{
              fontSize: 12, padding: "3px 8px", borderRadius: 8, cursor: "pointer",
              border: `1px solid ${premium ? "#6366F1" : "#333"}`,
              background: premium ? "rgba(99,102,241,0.15)" : "transparent",
              color: premium ? "#6366F1" : "#555",
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
