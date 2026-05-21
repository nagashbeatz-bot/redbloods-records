"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";

const NAV_MAIN = [
  { href: "/dashboard", label: "דשבורד",   icon: "⬡", iconColor: "#38BDF8" },
  { href: "/projects",  label: "פרויקטים", icon: "♫", iconColor: "#60A5FA" },
  { href: "/clients",   label: "לקוחות",   icon: "☆", iconColor: "#C084FC" },
  { href: "/team",      label: "צוות",     icon: "👥", iconColor: "#A855F7" },
  { href: "/finance",   label: "כספים",    icon: "₪", iconColor: "#34D399" },
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

// ── Mobile bottom nav items — 5 tabs: Dashboard, Projects, Finance, Calendar, More ──

const MOBILE_TABS = [
  { href: "/dashboard",      label: "דשבורד",   icon: "⬡", iconColor: "#38BDF8" },
  { href: "/projects",       label: "פרויקטים", icon: "♫", iconColor: "#60A5FA" },
  { href: "/finance",        label: "כספים",    icon: "₪", iconColor: "#34D399" },
  { href: "/setup/calendar", label: "יומן",     icon: "📅", iconColor: undefined },
];

const MORE_ITEMS = [
  { href: "/clients",       label: "לקוחות",   icon: "☆", iconColor: "#C084FC" },
  { href: "/team",          label: "צוות",     icon: "👥", iconColor: "#A855F7" },
  { href: "/insights",      label: "תובנות",   icon: "◎", iconColor: "#2DD4BF" },
  { href: "/setup/dropbox", label: "Dropbox",   icon: "📦", iconColor: undefined },
  { href: "/setup/reports", label: "דוחות",    icon: "📧", iconColor: undefined },
  { href: "/push-test",     label: "🔔 התראות", icon: "🔔", iconColor: "#F59E0B" },
];

// ── "More" bottom sheet ───────────────────────────────────────────────────────

function MoreSheet({ onClose, onOpenChat, pathname, insightsBadge }: {
  onClose: () => void;
  onOpenChat?: () => void;
  pathname: string;
  insightsBadge?: number;
}) {
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 99990,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rb-sheet-in"
        style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          background: "#141414",
          borderTop: "1px solid #2A2A2A",
          borderRadius: "20px 20px 0 0",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "#333" }} />
        </div>

        <div style={{ padding: "4px 16px 8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {MORE_ITEMS.map(({ href, label, icon, iconColor }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            const badge = href === "/insights" ? (insightsBadge ?? 0) : 0;
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "14px 16px", borderRadius: 14,
                  background: active ? "rgba(59,130,246,0.12)" : "#1A1A1A",
                  border: `1px solid ${active ? "rgba(59,130,246,0.3)" : "#252525"}`,
                  color: active ? "#3B82F6" : "#AAA",
                  fontSize: 15, fontWeight: 600,
                  textDecoration: "none", position: "relative",
                }}
              >
                <span style={{ fontSize: 20, ...(iconColor ? { color: iconColor } : {}) }}>{icon}</span>
                <span style={{ flex: 1 }}>{label}</span>
                {badge > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: "#141414",
                    background: "#EF4444", borderRadius: 10,
                    padding: "1px 6px", minWidth: 18, textAlign: "center",
                  }}>
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
          {/* Agent button inside more sheet */}
          <button
            onClick={() => { onClose(); onOpenChat?.(); }}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "14px 16px", borderRadius: 14,
              background: "#1A1A1A", border: "1px solid #252525",
              color: "#A855F7", fontSize: 15, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <span style={{ fontSize: 20 }}>✦</span>
            סוכן AI
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  onOpenChat?: () => void;
}

export default function Sidebar({ onOpenChat }: Props) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  useEffect(() => {
    fetch("/api/agent/alerts?status=new&count=1")
      .then((r) => r.json())
      .then((d) => setUnreadAlerts(d.count ?? 0))
      .catch(() => { /* ignore */ });
  }, []);

  // Is any "more" item currently active?
  const moreActive = MORE_ITEMS.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  );

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
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

      {/* ── Mobile bottom nav — 5 tabs ──────────────────────────────────── */}
      <nav
        className="md:hidden fixed bottom-0 right-0 left-0 z-50 border-t"
        style={{
          background: "#141414", borderColor: "#2A2A2A",
          display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {MOBILE_TABS.map(({ href, label, icon, iconColor }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                gap: 3, padding: "10px 0", minHeight: 56,
                color: active ? "#3B82F6" : "#666",
                fontSize: 10, fontWeight: 600, textDecoration: "none",
              }}
            >
              <span style={{ fontSize: 22, lineHeight: 1, ...(iconColor ? { color: active ? iconColor : "#555" } : {}) }}>
                {icon}
              </span>
              {label}
            </Link>
          );
        })}

        {/* "More" tab */}
        <button
          onClick={() => setMoreOpen(true)}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            gap: 3, padding: "10px 0", minHeight: 56,
            color: moreActive || moreOpen ? "#3B82F6" : "#666",
            fontSize: 10, fontWeight: 600,
            background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <span style={{ fontSize: 22, lineHeight: 1 }}>•••</span>
          עוד
        </button>
      </nav>

      {/* "More" bottom sheet */}
      {moreOpen && (
        <MoreSheet
          onClose={() => setMoreOpen(false)}
          onOpenChat={onOpenChat}
          pathname={pathname}
          insightsBadge={unreadAlerts}
        />
      )}
    </>
  );
}
