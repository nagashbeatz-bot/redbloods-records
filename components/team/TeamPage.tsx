"use client";

import { useState, useMemo } from "react";
import VictorCard from "./VictorCard";
import { useProjects } from "@/components/ProjectsProvider";

const BRAND  = "#DC2626";
const CARD   = "#111318";
const BDR    = "rgba(255,255,255,0.07)";
const TEXT   = "#F2F2F2";
const MUTED  = "#52526A";
const GREEN  = "#10B981";
const PURPLE = "#8B5CF6";
const BG     = "#0A0A0D";

interface Vendor {
  id: string;
  name: string;
  role: string;
  skills: string;
  status: string;
  type: "sound-engineer" | "beatmaker";
  hasProfile: boolean;
  initial: string;
  color: string;
}

const VENDORS: Vendor[] = [
  {
    id: "steven",
    name: "Steven",
    role: "מהנדס סאונד",
    skills: "מיקסינג · מאסטרינג",
    status: "פעיל",
    type: "sound-engineer",
    hasProfile: false,
    initial: "S",
    color: BRAND,
  },
  {
    id: "victor",
    name: "Victor",
    role: "מפיק ביטים",
    skills: "הפקה · סאונד",
    status: "פעיל",
    type: "beatmaker",
    hasProfile: true,
    initial: "V",
    color: PURPLE,
  },
];

function KpiCard({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
  return (
    <div style={{
      background: CARD,
      border: `1px solid ${BDR}`,
      borderRadius: 14,
      padding: "16px 18px",
      position: "relative",
      overflow: "hidden",
      flex: 1,
    }}>
      <div style={{ position: "absolute", bottom: -6, left: -4, fontSize: 48, opacity: 0.05, userSelect: "none", pointerEvents: "none", lineHeight: 1 }}>{icon}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color, letterSpacing: "-0.03em", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function VendorCard({ vendor, onOpenProfile }: { vendor: Vendor; onOpenProfile: () => void }) {
  return (
    <div style={{
      background: CARD,
      border: `1px solid ${BDR}`,
      borderRadius: 16,
      padding: "20px 20px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 14,
    }}>
      {/* Avatar + info */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{
          width: 52, height: 52, borderRadius: "50%",
          background: `linear-gradient(135deg, ${vendor.color}33, ${vendor.color}66)`,
          border: `2px solid ${vendor.color}55`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, fontWeight: 900, color: vendor.color,
          flexShrink: 0,
        }}>
          {vendor.initial}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: TEXT }}>{vendor.name}</span>
            <span style={{
              fontSize: 10, fontWeight: 700,
              padding: "2px 8px", borderRadius: 6,
              background: `${vendor.color}18`,
              border: `1px solid ${vendor.color}33`,
              color: vendor.color,
            }}>{vendor.role}</span>
          </div>
          <div style={{ fontSize: 12, color: MUTED }}>{vendor.skills}</div>
        </div>
        {/* Status dot */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN }} />
          <span style={{ fontSize: 11, color: GREEN, fontWeight: 600 }}>{vendor.status}</span>
        </div>
      </div>

      {/* Action button */}
      {vendor.hasProfile ? (
        <button
          onClick={onOpenProfile}
          style={{
            width: "100%", padding: "9px 0", borderRadius: 10,
            background: `${vendor.color}18`,
            border: `1px solid ${vendor.color}33`,
            color: vendor.color,
            fontSize: 13, fontWeight: 700, cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          פתח פרופיל ↓
        </button>
      ) : (
        <button
          disabled
          title="בקרוב"
          style={{
            width: "100%", padding: "9px 0", borderRadius: 10,
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${BDR}`,
            color: MUTED,
            fontSize: 13, fontWeight: 700,
            cursor: "not-allowed",
            fontFamily: "inherit",
          }}
        >
          פתח פרופיל · בקרוב
        </button>
      )}
    </div>
  );
}

export default function TeamPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("הכל");
  const [showVictorDetail, setShowVictorDetail] = useState(false);

  const { projects } = useProjects();

  const openProjectsCount = useMemo(
    () => projects.filter(p => !p.isHidden && p.status !== "הושלם").length,
    [projects]
  );

  const filteredVendors = useMemo(() => {
    return VENDORS.filter(v => {
      const matchSearch = !search.trim() ||
        v.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        v.role.includes(search.trim());
      const matchType = typeFilter === "הכל" ||
        (typeFilter === "מהנדס סאונד" && v.type === "sound-engineer") ||
        (typeFilter === "מפיק ביטים" && v.type === "beatmaker");
      return matchSearch && matchType;
    });
  }, [search, typeFilter]);

  return (
    <div dir="rtl" style={{
      minHeight: "100%",
      background: BG,
      color: TEXT,
      fontFamily: "'Heebo', Arial, sans-serif",
      padding: "28px 28px 80px",
    }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: TEXT, margin: "0 0 6px", letterSpacing: "-0.02em" }}>
          צוות / ספקים
        </h1>
        <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
          ניהול ספקים חיצוניים ומומחים בפרויקטים
        </p>
      </div>

      {/* KPI Row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 28 }}>
        <KpiCard label="ספקים פעילים"  value={2}                icon="👥" color={PURPLE} />
        <KpiCard label="מהנדסי סאונד"   value={1}                icon="🎧" color={BRAND}  />
        <KpiCard label="מפיקי ביטים"    value={1}                icon="🎵" color={PURPLE} />
        <KpiCard label="פרויקטים פתוחים" value={openProjectsCount} icon="📁" color={MUTED}  />
      </div>

      {/* Search + Filter Bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 22, alignItems: "center" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="חיפוש ספקים..."
          style={{
            flex: 1, padding: "9px 14px", borderRadius: 10,
            background: CARD, border: `1px solid ${BDR}`,
            color: TEXT, fontSize: 13, outline: "none",
            fontFamily: "inherit",
          }}
        />
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          style={{
            padding: "9px 12px", borderRadius: 10,
            background: CARD, border: `1px solid ${BDR}`,
            color: TEXT, fontSize: 13, outline: "none",
            fontFamily: "inherit", cursor: "pointer",
          }}
        >
          <option value="הכל">כל הסוגים</option>
          <option value="מהנדס סאונד">מהנדס סאונד</option>
          <option value="מפיק ביטים">מפיק ביטים</option>
        </select>

        {/* Add vendor button */}
        <button
          disabled
          title="בקרוב"
          style={{
            padding: "9px 18px", borderRadius: 10,
            background: BRAND, border: "none",
            color: "#fff", fontSize: 13, fontWeight: 700,
            cursor: "not-allowed", opacity: 0.7,
            fontFamily: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          + הוסף ספק חדש
        </button>
      </div>

      {/* Vendor Grid */}
      {filteredVendors.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: MUTED, fontSize: 14 }}>
          לא נמצאו ספקים
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 14,
          marginBottom: 24,
        }}>
          {filteredVendors.map(vendor => (
            <VendorCard
              key={vendor.id}
              vendor={vendor}
              onOpenProfile={() => {
                if (vendor.id === "victor") setShowVictorDetail(true);
              }}
            />
          ))}
        </div>
      )}

      {/* Victor Detail Section */}
      {showVictorDetail && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>פרופיל — Victor</span>
            <button
              onClick={() => setShowVictorDetail(false)}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: `1px solid ${BDR}`,
                borderRadius: 8,
                color: MUTED,
                fontSize: 12, fontWeight: 700,
                padding: "5px 12px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              סגור פרופיל ↑
            </button>
          </div>
          <VictorCard />
        </div>
      )}
    </div>
  );
}
