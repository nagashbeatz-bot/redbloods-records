"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ProjectPageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[/projects/[id]] error:", error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#0D0D0D",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.3 }}>⚠</div>
      <p style={{ color: "#888", fontSize: 14, marginBottom: 8 }}>שגיאה בטעינת הפרויקט</p>
      <p style={{ color: "#444", fontSize: 12, marginBottom: 24, fontFamily: "monospace" }}>
        {error.message || "שגיאה לא ידועה"}
      </p>
      <div style={{ display: "flex", gap: 12 }}>
        <button
          onClick={reset}
          style={{
            padding: "8px 20px", borderRadius: 10,
            background: "#1A1A1A", border: "1px solid #2A2A2A",
            color: "#CCC", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          נסה שוב
        </button>
        <Link
          href="/projects"
          style={{
            padding: "8px 20px", borderRadius: 10,
            background: "#1A1A1A", border: "1px solid #2A2A2A",
            color: "#3B82F6", fontSize: 13, textDecoration: "none",
            display: "inline-block",
          }}
        >
          חזרה לפרויקטים
        </Link>
      </div>
    </div>
  );
}
