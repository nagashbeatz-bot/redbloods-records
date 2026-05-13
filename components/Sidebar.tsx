"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_MAIN = [
  { href: "/dashboard", label: "דשבורד",   icon: "⬡" },
  { href: "/projects",  label: "פרויקטים", icon: "♫" },
  { href: "/clients",   label: "לקוחות",   icon: "👥" },
];

const NAV_SETTINGS = [
  { href: "/setup/calendar", label: "יומן",   icon: "📅" },
  { href: "/setup/reports",  label: "דוחות",  icon: "📧" },
];

function NavLink({ href, label, icon, pathname }: { href: string; label: string; icon: string; pathname: string }) {
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
      <span className="text-base">{icon}</span>
      {label}
    </Link>
  );
}

interface Props {
  onOpenChat?: () => void;
}

export default function Sidebar({ onOpenChat }: Props) {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col h-screen w-56 sticky top-0 border-l"
        style={{ background: "#141414", borderColor: "#2A2A2A" }}
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
              <div className="text-sm font-bold" style={{ color: "#F0F0F0" }}>
                Redbloods
              </div>
              <div className="text-xs" style={{ color: "#888" }}>
                Records
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4">
          <div className="space-y-1">
            {NAV_MAIN.map(({ href, label, icon }) => (
              <NavLink key={href} href={href} label={label} icon={icon} pathname={pathname} />
            ))}
          </div>

          <div className="mt-5 mb-2 px-3" style={{ fontSize: 10, fontWeight: 700, color: "#3A3A3A", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            ניהול
          </div>
          <div style={{ height: 1, background: "#1E1E1E", marginBottom: 8 }} />

          <div className="space-y-1">
            {NAV_SETTINGS.map(({ href, label, icon }) => (
              <NavLink key={href} href={href} label={label} icon={icon} pathname={pathname} />
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t" style={{ borderColor: "#2A2A2A" }}>
          <div className="text-xs" style={{ color: "#555" }}>
            גרסה 1.0 MVP
          </div>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 right-0 left-0 z-50 flex border-t"
        style={{ background: "#141414", borderColor: "#2A2A2A", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {[...NAV_MAIN, ...NAV_SETTINGS].map(({ href, label, icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className="flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium"
              style={{ color: active ? "#3B82F6" : "#888" }}
            >
              <span className="text-xl">{icon}</span>
              {label}
            </Link>
          );
        })}
        {/* AI Agent button */}
        <button
          onClick={onOpenChat}
          className="flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium"
          style={{ color: "#A855F7", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
        >
          <span className="text-xl">✦</span>
          סוכן
        </button>
      </nav>
    </>
  );
}
