"use client";

import { useState, useMemo } from "react";
import VictorCard from "./VictorCard";
import { useProjects } from "@/components/ProjectsProvider";

const BRAND  = "#DC2626";
const CARD   = "#111318";
const CARD2  = "#0D0D12";
const BDR    = "rgba(255,255,255,0.07)";
const BDR2   = "rgba(255,255,255,0.11)";
const TEXT   = "#F2F2F2";
const MUTED  = "#52526A";
const TEXT2  = "#A0A0B0";
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

function KpiCard({
  label, value, icon, color,
}: {
  label: string; value: string | number; icon: string; color: string;
}) {
  return (
    <div style={{
      background: CARD,
      border: `1px solid ${BDR2}`,
      borderRadius: 18,
      padding: "22px 24px 20px",
      position: "relative",
      overflow: "hidden",
      flex: 1,
      minWidth: 0,
    }}>
      {/* ghost icon */}
      <div style={{
        position: "absolute", bottom: -8, left: -6,
        fontSize: 64, opacity: 0.05,
        userSelect: "none", pointerEvents: "none", lineHeight: 1,
      }}>
        {icon}
      </div>
      <div style={{
        fontSize: 11, fontWeight: 700, color: MUTED,
        letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 12,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 36, fontWeight: 900, color,
        letterSpacing: "-0.04em", lineHeight: 1,
      }}>
        {value}
      </div>
    </div>
  );
}

function VendorCard({
  vendor, onOpenProfile,
}: {
  vendor: Vendor; onOpenProfile: () => void;
}) {
  return (
    <div style={{
      background: CARD,
      border: `1px solid ${BDR2}`,
      borderRadius: 20,
      padding: "32px 32px 26px",
      display: "flex",
      flexDirection: "column",
      gap: 22,
    }}>
      {/* Top: avatar + name/role + status */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
        {/* Avatar */}
        <div style={{
          width: 78, height: 78, borderRadius: "50%", flexShrink: 0,
          background: `linear-gradient(135deg, ${vendor.color}22, ${vendor.color}55)`,
          border: `2px solid ${vendor.color}55`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 30, fontWeight: 900, color: vendor.color,
          boxShadow: `0 0 20px ${vendor.color}18`,
        }}>
          {vendor.initial}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: TEXT }}>{vendor.name}</span>
            <span style={{
              fontSize: 11, fontWeight: 700,
              padding: "3px 10px", borderRadius: 8,
              background: `${vendor.color}18`,
              border: `1px solid ${vendor.color}33`,
              color: vendor.color,
              whiteSpace: "nowrap",
            }}>
              {vendor.role}
            </span>
          </div>
          <div style={{ fontSize: 13, color: TEXT2, marginBottom: 10 }}>
            {vendor.skills}
          </div>
          {/* Status */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%", background: GREEN,
              boxShadow: `0 0 6px ${GREEN}88`,
            }} />
            <span style={{ fontSize: 12, color: GREEN, fontWeight: 600 }}>
              {vendor.status}
            </span>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: BDR }} />

      {/* Action */}
      {vendor.hasProfile ? (
        <button
          onClick={onOpenProfile}
          style={{
            width: "100%", padding: "12px 0", borderRadius: 12,
            background: `${vendor.color}18`,
            border: `1px solid ${vendor.color}44`,
            color: vendor.color,
            fontSize: 14, fontWeight: 700, cursor: "pointer",
            fontFamily: "inherit",
            transition: "none",
          }}
        >
          פתח פרופיל ↓
        </button>
      ) : (
        <button
          disabled
          title="הפרופיל יהיה זמין בקרוב"
          style={{
            width: "100%", padding: "12px 0", borderRadius: 12,
            background: "rgba(255,255,255,0.05)",
            border: `1px solid rgba(255,255,255,0.12)`,
            color: "#8A8AA0",
            fontSize: 14, fontWeight: 700,
            cursor: "not-allowed",
            fontFamily: "inherit",
            letterSpacing: "0.01em",
          }}
        >
          פרופיל בקרוב
        </button>
      )}
    </div>
  );
}

export default function TeamPage() {
  const [search, setSearch]   = useState("");
  const [typeFilter, setTypeFilter] = useState("הכל");
  const [showVictorDetail, setShowVictorDetail] = useState(false);

  const { projects } = useProjects();

  const openProjectsCount = useMemo(
    () => projects.filter(p => !p.isHidden && p.status !== "הושלם").length,
    [projects],
  );

  const filteredVendors = useMemo(() => {
    return VENDORS.filter(v => {
      const q = search.trim().toLowerCase();
      const matchSearch = !q ||
        v.name.toLowerCase().includes(q) ||
        v.role.includes(search.trim());
      const matchType =
        typeFilter === "הכל" ||
        (typeFilter === "מהנדס סאונד" && v.type === "sound-engineer") ||
        (typeFilter === "מפיק ביטים"  && v.type === "beatmaker");
      return matchSearch && matchType;
    });
  }, [search, typeFilter]);

  return (
    <div
      dir="rtl"
      style={{
        minHeight: "100%",
        background: BG,
        color: TEXT,
        fontFamily: "'Heebo', Arial, sans-serif",
        padding: "32px 24px 80px",
      }}
    >
      {/* ── Centered content wrapper ── */}
      <div style={{ maxWidth: 1140, margin: "0 auto" }}>

        {/* Header row */}
        <div style={{
          display: "flex", alignItems: "flex-start",
          justifyContent: "space-between", marginBottom: 32, gap: 16,
          flexWrap: "wrap",
        }}>
          <div>
            <h1 style={{
              fontSize: 30, fontWeight: 900, color: TEXT,
              margin: "0 0 6px", letterSpacing: "-0.02em",
            }}>
              צוות / ספקים
            </h1>
            <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
              ניהול ספקים חיצוניים ומומחים בפרויקטים
            </p>
          </div>

          {/* CTA */}
          <button
            disabled
            title="בקרוב"
            style={{
              padding: "10px 22px", borderRadius: 12,
              background: BRAND, border: "none",
              color: "#fff", fontSize: 14, fontWeight: 800,
              cursor: "not-allowed", opacity: 0.65,
              fontFamily: "inherit",
              boxShadow: "0 2px 16px rgba(220,38,38,0.35)",
              whiteSpace: "nowrap",
              alignSelf: "flex-start",
              marginTop: 2,
            }}
          >
            + הוסף ספק חדש
          </button>
        </div>

        {/* KPI row */}
        <div style={{ display: "flex", gap: 14, marginBottom: 32 }}>
          <KpiCard label="ספקים פעילים"   value={2}                 icon="👥" color={PURPLE} />
          <KpiCard label="מהנדסי סאונד"    value={1}                 icon="🎧" color={BRAND}  />
          <KpiCard label="מפיקי ביטים"     value={1}                 icon="🎵" color={PURPLE} />
          <KpiCard label="פרויקטים פתוחים" value={openProjectsCount} icon="📁" color={TEXT2}  />
        </div>

        {/* Search + filter bar */}
        <div style={{
          display: "flex", gap: 10, marginBottom: 16,
          alignItems: "center", flexWrap: "wrap",
        }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש ספקים..."
            style={{
              flex: 1, minWidth: 180,
              padding: "10px 16px", borderRadius: 12,
              background: CARD, border: `1px solid ${BDR}`,
              color: TEXT, fontSize: 13, outline: "none",
              fontFamily: "inherit",
            }}
          />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            style={{
              padding: "10px 14px", borderRadius: 12,
              background: CARD, border: `1px solid ${BDR}`,
              color: TEXT, fontSize: 13, outline: "none",
              fontFamily: "inherit", cursor: "pointer",
            }}
          >
            <option value="הכל">כל הסוגים</option>
            <option value="מהנדס סאונד">מהנדס סאונד</option>
            <option value="מפיק ביטים">מפיק ביטים</option>
          </select>
          <span style={{ fontSize: 12, color: MUTED }}>
            {filteredVendors.length} ספקים
          </span>
        </div>

        {/* Vendor cards grid */}
        {filteredVendors.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "60px 0",
            color: MUTED, fontSize: 14,
          }}>
            לא נמצאו ספקים
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: 18,
            marginBottom: 32,
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

        {/* Victor detail section */}
        {showVictorDetail && (
          <div style={{ marginTop: 8 }}>
            <div style={{
              display: "flex", alignItems: "center",
              justifyContent: "space-between", marginBottom: 20,
              padding: "14px 20px",
              background: CARD2,
              border: `1px solid ${BDR}`,
              borderRadius: 14,
            }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>
                פרופיל — Victor
              </span>
              <button
                onClick={() => setShowVictorDetail(false)}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: `1px solid ${BDR}`,
                  borderRadius: 8,
                  color: TEXT2,
                  fontSize: 12, fontWeight: 700,
                  padding: "6px 14px",
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

      </div>{/* /container */}
    </div>
  );
}
