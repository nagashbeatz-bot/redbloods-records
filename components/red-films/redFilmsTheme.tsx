"use client";

/**
 * Red Films — LOCAL design tokens + shared UI atoms for the /red-films screens
 * ONLY. Imported solely by RedFilmsPage.tsx and RedFilmsEquipment.tsx to keep
 * the two tabs visually identical without duplicating the palette/card/table
 * styling. This is NOT a global theme change: nothing here is consumed outside
 * the components/red-films folder, and it emits only inline styles.
 *
 * Design intent (v2 "calm charcoal"): keep the black-and-red Red Films branding
 * but make it cleaner and easier on the eye — deep-black page, charcoal panels,
 * subtle dark-gray borders, and red reserved for the primary action / active
 * state only (no heavy red frames or glow on every surface).
 */

import type { CSSProperties, ReactNode } from "react";

// ── Palette ─────────────────────────────────────────────────────────────────
export const RF = {
  // Brand reds (unchanged hues — the existing Redbloods red)
  red:      "#DC2626",
  redLight: "#F87171",
  redGrad:  "linear-gradient(135deg, #EF4444, #B91C1C)", // primary action button
  // Calm charcoal surfaces
  panel:      "#161719", // card / table body — a touch lighter than the page
  panelHover: "#1D1E21", // panel hover / neutral button
  header:     "#1E1F22", // table header — slightly lighter than the body
  border:     "#2A2B2F", // subtle dark-gray border
  borderSoft: "rgba(255,255,255,0.055)", // in-table row dividers
  // Text
  text:     "#F2F2F4", // primary
  textSub:  "#9A9AA2", // secondary
  textMute: "#6E6E76", // muted / empty
  // Status accents (kept from the existing map)
  green: "#4ADE80",
  gray:  "#6B7280",
  // Active tab (dark red — brighter red border, white text/icon)
  tabActiveBg:     "linear-gradient(180deg, rgba(220,38,38,0.26), rgba(127,20,20,0.32))",
  tabActiveBorder: "rgba(220,38,38,0.55)",
} as const;

// ── Shared style helpers ────────────────────────────────────────────────────

/** Rounded pill filter chip — active = subtle red, idle = charcoal. */
export function filterChip(on: boolean): CSSProperties {
  return {
    padding: "8px 20px", borderRadius: 999, fontSize: 13.5, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit", border: "1px solid",
    background:  on ? "rgba(220,38,38,0.14)" : RF.panel,
    color:       on ? RF.redLight : RF.textSub,
    borderColor: on ? "rgba(220,38,38,0.5)" : RF.border,
    transition: "all 0.15s",
  };
}

/** Neutral secondary button (open / edit / more) — charcoal, gray border. */
export const neutralBtn: CSSProperties = {
  background: "rgba(255,255,255,0.04)", border: `1px solid ${RF.border}`,
  color: "#C6C6CE", fontFamily: "inherit", cursor: "pointer",
};

/** The charcoal table container shell (desktop). */
export const tableShell: CSSProperties = {
  background: RF.panel, border: `1px solid ${RF.border}`, borderRadius: 16,
  overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.32)",
};

/** The (slightly lighter) table header strip. */
export const tableHeaderBar: CSSProperties = {
  background: RF.header, borderBottom: `1px solid ${RF.border}`,
  fontSize: 12, color: RF.textSub, fontWeight: 700, letterSpacing: "0.01em",
};

// ── KPI card (shared by both tabs) ──────────────────────────────────────────
export function KpiCard({ icon, label, value, valueSize = 40 }: {
  icon: ReactNode; label: string; value: string | number; valueSize?: number;
}) {
  return (
    <div style={{
      minWidth: 0, background: RF.panel, border: `1px solid ${RF.border}`,
      borderRadius: 16, padding: "18px 20px 20px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <span style={{ fontSize: 13.5, color: RF.textSub, fontWeight: 600 }}>{label}</span>
        <span style={{
          width: 38, height: 38, borderRadius: 10, flexShrink: 0, color: RF.redLight,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(220,38,38,0.10)", border: "1px solid rgba(220,38,38,0.22)",
        }}>{icon}</span>
      </div>
      <div style={{
        fontSize: valueSize, fontWeight: 800, color: RF.text,
        letterSpacing: "-0.02em", lineHeight: 1, textAlign: "center",
      }}>{value}</div>
    </div>
  );
}
