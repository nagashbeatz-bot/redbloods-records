"use client";

import { useState } from "react";
import VictorCard from "./VictorCard";

export default function TeamPage() {
  return (
    <div style={{ padding: "24px 16px 80px", maxWidth: 720, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F0", margin: 0 }}>
          👥 צוות / ספקים
        </h1>
        <p style={{ fontSize: 13, color: "#555", margin: "4px 0 0" }}>
          ניהול אנשי צוות וספקים של הלייבל
        </p>
      </div>

      {/* Victor card */}
      <VictorCard />

      {/* Placeholder cards for future team members */}
      <div style={{
        marginTop: 12,
        border: "1px dashed #2A2A2A",
        borderRadius: 14,
        padding: "18px 20px",
        color: "#444",
        fontSize: 13,
        textAlign: "center",
      }}>
        Bill · יאיר · פרנסיס · רועי — יתווספו בהמשך
      </div>
    </div>
  );
}
