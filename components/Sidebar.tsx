"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_MAIN = [
  { href: "/dashboard", label: "דשבורד",   icon: "⬡", iconColor: "#38BDF8" },
  { href: "/projects",  label: "פרויקטים", icon: "♫", iconColor: "#60A5FA" },
  { href: "/clients",   label: "לקוחות",   icon: "☆", iconColor: "#C084FC" },
  { href: "/tasks",     label: "משימות",   icon: "✓", iconColor: "#F59E0B" },
  { href: "/team",       label: "צוות",      icon: "👥", iconColor: "#A855F7" },
  { href: "/red-films", label: "Red Films", icon: "🎬", iconColor: "#EC4899" },
  { href: "/finance",   label: "כספים",    icon: "₪",  iconColor: "#34D399" },
  { href: "/insights",  label: "תובנות",   icon: "◎", iconColor: "#2DD4BF" },
];

const NAV_SETTINGS = [
  { href: "/setup/calendar", label: "יומן",    icon: "📅", iconColor: undefined },
  { href: "/setup/dropbox",  label: "Dropbox",  icon: "📦", iconColor: undefined },
  { href: "/setup/reports",  label: "דוחות",   icon: "📧", iconColor: undefined },
];

// ── Desktop sidebar nav link ──────────────────────────────────────────────────

function NavLink({ href, label, icon, iconColor, pathname, badge }: {
  href: string; label: string; icon: string; iconColor?: string; pathname: string; badge?: number;
}) {
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
      style={{
        background: active ? "rgba(59,130,246,0.15)" : "transparent",
        color: active ? "#3B82F6" : "#888",
        borderColor: active ? "rgba(59,130,246,0.3)" : "transparent",
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
          padding: "1px 6px", minWidth: 18, textAlign: "center",
          lineHeight: "16px",
        }}>
          {badge}
        </span>
      )}
    </Link>
  );
}

// ── Main component (desktop only) ────────────────────────────────────────────
// Mobile bottom nav has been moved to MobileNav.tsx and is rendered
// as an in-flow flex child of AppShell (not position:fixed).

export default function Sidebar({ onOpenChat: _onOpenChat }: { onOpenChat?: () => void }) {
  const pathname = usePathname();
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  useEffect(() => {
    fetch("/api/agent/alerts?status=new&count=1")
      .then((r) => r.json())
      .then((d) => setUnreadAlerts(d.count ?? 0))
      .catch(() => { /* ignore */ });
  }, []);

  return (
    <>
      {/* ── Desktop sidebar (mobile nav is in MobileNav.tsx) ────────────── */}
      <aside
        className="hidden md:flex flex-col sticky top-0 border-l"
        style={{ background: "#141414", borderColor: "#2A2A2A", width: 224, height: "100dvh" }}
      >
        {/* Logo */}
        <div className="px-5 py-6 border-b" style={{ borderColor: "#2A2A2A" }}>
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
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4">
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
              />
            ))}
          </div>
          <div className="mt-5 mb-2 px-3" style={{ fontSize: 10, fontWeight: 700, color: "#4A4A4A", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            ניהול
          </div>
          <div style={{ height: 1, background: "#282828", marginBottom: 8 }} />
          <div className="space-y-1">
            {NAV_SETTINGS.map(({ href, label, icon, iconColor }) => (
              <NavLink key={href} href={href} label={label} icon={icon} iconColor={iconColor} pathname={pathname} />
            ))}
          </div>
        </nav>

        <div className="px-5 py-4 border-t" style={{ borderColor: "#2A2A2A" }}>
          <div className="text-xs" style={{ color: "#555" }}>גרסה 1.0 MVP</div>
        </div>
      </aside>
    </>
  );
}
