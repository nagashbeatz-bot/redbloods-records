"use client";

import { useState, useEffect, type RefObject } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useRole } from "@/lib/use-role";
import { signOutAndRedirect } from "@/lib/supabase-browser";
import { useVictorT } from "@/lib/victor-i18n";
import { MAI_AI_ENABLED } from "@/lib/feature-flags";

const MOBILE_TABS = [
  { href: "/dashboard",      label: "דשבורד",   icon: "⬡", iconColor: "#38BDF8" },
  { href: "/projects",       label: "פרויקטים", icon: "♫", iconColor: "#60A5FA" },
  { href: "/finance",        label: "כספים",    icon: "₪", iconColor: "#34D399" },
  { href: "/setup/calendar", label: "יומן",     icon: "📅", iconColor: undefined },
];

const MORE_ITEMS = [
  { href: "/social",        label: "סושיאל",   icon: "📱", iconColor: "#EC4899" },
  { href: "/clients",       label: "לקוחות",   icon: "☆", iconColor: "#C084FC" },
  { href: "/tasks",         label: "משימות",   icon: "✓", iconColor: "#F59E0B" },
  { href: "/team",          label: "צוות",     icon: "👥", iconColor: "#A855F7" },
  { href: "/shows",         label: "הופעות",   icon: "🎤", iconColor: "#F472B6" },
  { href: "/red-films",     label: "Red Films", icon: "🎬", iconColor: "#EC4899" },
  { href: "/red-artists",   label: "Red Artists", icon: "🎤", iconColor: "#DC2626" },
  { href: "/insights",      label: "תובנות",   icon: "◎", iconColor: "#2DD4BF" },
  { href: "/setup/dropbox", label: "Dropbox",   icon: "📦", iconColor: undefined },
  { href: "/setup/reports", label: "דוחות",    icon: "📧", iconColor: undefined },
  { href: "/push-test",     label: "🔔 התראות", icon: "🔔", iconColor: "#F59E0B" },
];

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
                  background: active ? "rgba(220,38,38,0.12)" : "#1A1A1A",
                  border: `1px solid ${active ? "rgba(220,38,38,0.3)" : "#252525"}`,
                  color: active ? "#DC2626" : "#AAA",
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
          {MAI_AI_ENABLED && (
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
          )}

          {/* Logout — full width at the bottom (user area) */}
          <button
            onClick={() => { onClose(); signOutAndRedirect(); }}
            style={{
              gridColumn: "1 / -1",
              display: "flex", alignItems: "center", gap: 12,
              padding: "14px 16px", borderRadius: 14, marginTop: 4,
              background: "rgba(220,38,38,0.10)", border: "1px solid rgba(220,38,38,0.35)",
              color: "#EF4444", fontSize: 15, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <span style={{ fontSize: 20 }}>🚪</span>
            <span style={{ flex: 1 }}>יציאה מהמערכת</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── MobileNav — in-flow bottom bar (NOT position:fixed) ───────────────────────
//
// Placed as the last flex child of AppShell (which is position:fixed inset:0).
// Being in the layout flow means it always sits at the real viewport bottom
// without depending on iOS fixed-positioning or env(safe-area-inset-bottom)
// being computed correctly on the first frame.

export default function MobileNav({
  onOpenChat,
  navRef,
}: {
  onOpenChat?: () => void;
  navRef?: RefObject<HTMLElement | null>;
}) {
  const pathname = usePathname();
  const role = useRole();
  const vt = useVictorT(); // Victor sees his language; owner keeps Hebrew via role gates
  const [moreOpen, setMoreOpen] = useState(false);
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  // Role-gated nav — must mirror the desktop Sidebar so mobile never exposes more
  // than desktop. Owner → full nav; Victor → only his page; null/unknown → none
  // (security is also enforced server-side in proxy.ts, this is defense-in-depth).
  const isOwner  = role === "owner";
  const isVictor = role === "victor";
  const tabs = isOwner
    ? MOBILE_TABS
    : isVictor
      ? [{ href: "/team/victor", label: "Victor", icon: "👤", iconColor: "#A855F7" as string | undefined }]
      : role === "steven"
        ? [{ href: "/team/steven", label: "Steven", icon: "🎚", iconColor: "#DC2626" as string | undefined }]
        : [];

  useEffect(() => {
    if (role !== "owner" || !MAI_AI_ENABLED) return; // owner-only; skipped while AI is disabled
    fetch("/api/agent/alerts?status=new&count=1")
      .then((r) => r.json())
      .then((d) => setUnreadAlerts(d.count ?? 0))
      .catch(() => {});
  }, [role]);

  // "more" sheet (extra sections) is owner-only.
  const moreActive = isOwner && MORE_ITEMS.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  );

  // Nothing to show while the role is still unknown — never default to the full nav.
  if (tabs.length === 0) return null;

  return (
    <>
      {/*
        md:hidden via className — NOT overridden by inline style.
        No position:fixed — this element is in the flex flow of AppShell,
        so it is always at the actual bottom of the viewport.
      */}
      <nav
        ref={navRef}
        className="app-shell-nav md:hidden border-t grid flex-shrink-0"
        style={{
          background: "#141414",
          borderColor: "#2A2A2A",
          gridTemplateColumns: `repeat(${tabs.length + 1}, 1fr)`,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {tabs.map(({ href, label, icon, iconColor }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                gap: 3, padding: "10px 0", minHeight: 56,
                color: active ? "#DC2626" : "#666",
                fontSize: 11, fontWeight: 600, textDecoration: "none",
              }}
            >
              <span style={{ fontSize: 22, lineHeight: 1, ...(iconColor ? { color: active ? iconColor : "#555" } : {}) }}>
                {icon}
              </span>
              {label}
            </Link>
          );
        })}

        {isOwner ? (
          <button
            onClick={() => setMoreOpen(true)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              gap: 3, padding: "10px 0", minHeight: 56,
              color: moreActive || moreOpen ? "#DC2626" : "#666",
              fontSize: 11, fontWeight: 600,
              background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>•••</span>
            עוד
          </button>
        ) : (
          // Non-owner (e.g. Victor) has no "more" sheet — give a direct logout.
          <button
            onClick={signOutAndRedirect}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              gap: 3, padding: "10px 0", minHeight: 56,
              color: "#DC2626", fontSize: 11, fontWeight: 700,
              background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>🚪</span>
            {/* Steven works in English — mirror the Sidebar's "Logout"; Victor
                keeps his own i18n label. (vt resolves to Hebrew for steven.) */}
            {role === "steven" ? "Logout" : vt("common.signOut")}
          </button>
        )}
      </nav>

      {isOwner && moreOpen && (
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
