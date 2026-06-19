import AppShell from "@/components/AppShell";
import ProjectsDesignPreview from "@/components/projects/ProjectsDesignPreview";

const QuickActionsBtn = (
  <button
    style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 20px", borderRadius: 10,
      fontSize: 13, fontWeight: 700,
      background: "#DC2626", border: "none", color: "#fff",
      cursor: "pointer",
      boxShadow: "0 2px 14px rgba(220,38,38,0.45)",
      letterSpacing: "0.01em", whiteSpace: "nowrap",
    }}
  >
    <span style={{ fontSize: 13 }}>⚡</span>
    פעולות מהירות
    <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
  </button>
);

export default function ProjectsPage() {
  return (
    <AppShell topRight={QuickActionsBtn}>
      <ProjectsDesignPreview />
    </AppShell>
  );
}
