import AppShell from "@/components/AppShell";
import SocialDesignPreview from "@/components/social/SocialDesignPreview";

const QuickActionsBtn = (
  <>
    <button
      className="flex md:hidden"
      style={{
        alignItems: "center", gap: 5,
        padding: "5px 10px 5px 12px", borderRadius: 100,
        fontSize: 11, fontWeight: 700,
        background: "#DC2626", border: "1px solid rgba(220,38,38,0.5)", color: "#fff",
        cursor: "pointer", outline: "none",
        WebkitTapHighlightColor: "transparent", transition: "none",
        letterSpacing: "0.06em", whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: 11 }}>⚡</span>פעולות<span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
    </button>
    <button
      className="hidden md:flex"
      style={{
        alignItems: "center", gap: 8,
        padding: "8px 20px", borderRadius: 10,
        fontSize: 13, fontWeight: 700,
        background: "#DC2626", border: "none", color: "#fff",
        cursor: "pointer", outline: "none",
        WebkitTapHighlightColor: "transparent", transition: "none",
        boxShadow: "0 2px 14px rgba(220,38,38,0.45)",
        letterSpacing: "0.01em", whiteSpace: "nowrap",
      }}
    >
      <span>⚡</span>פעולות מהירות<span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
    </button>
  </>
);

export default function SocialPreviewPage() {
  return (
    <AppShell topRight={QuickActionsBtn}>
      <SocialDesignPreview />
    </AppShell>
  );
}
