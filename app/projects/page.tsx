import AppShell from "@/components/AppShell";
import ProjectsDesignPreview from "@/components/projects/ProjectsDesignPreview";

const QuickActionsBtn = (
  <button
    style={{
      display: "flex", alignItems: "center", gap: 5,
      padding: "5px 10px 5px 12px", borderRadius: 100,
      fontSize: 11, fontWeight: 700,
      background: "#DC2626", border: "1px solid rgba(220,38,38,0.5)", color: "#fff",
      cursor: "pointer",
      outline: "none",
      WebkitTapHighlightColor: "transparent",
      transition: "none",
      letterSpacing: "0.06em", whiteSpace: "nowrap",
    }}
  >
    <span style={{ fontSize: 11 }}>⚡</span>
    <span className="inline md:hidden">פעולות</span>
    <span className="hidden md:inline">פעולות מהירות</span>
    <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
  </button>
);

export default function ProjectsPage() {
  return (
    <AppShell topRight={QuickActionsBtn}>
      <ProjectsDesignPreview />
    </AppShell>
  );
}
