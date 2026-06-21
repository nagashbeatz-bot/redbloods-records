import AppShell from "@/components/AppShell";
import SocialDesignPreview from "@/components/social/SocialDesignPreview";

const NewPostBtn = (
  <button
    style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 20px", borderRadius: 10,
      fontSize: 13, fontWeight: 700,
      background: "#EC4899", border: "none", color: "#fff",
      cursor: "pointer",
      boxShadow: "0 2px 14px rgba(236,72,153,0.45)",
      letterSpacing: "0.01em", whiteSpace: "nowrap",
      outline: "none", transition: "none",
      WebkitTapHighlightColor: "transparent",
    }}
  >
    <span style={{ fontSize: 13 }}>📱</span>
    סושיאל
    <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
  </button>
);

export default function SocialPreviewPage() {
  return (
    <AppShell topRight={NewPostBtn}>
      <SocialDesignPreview />
    </AppShell>
  );
}
