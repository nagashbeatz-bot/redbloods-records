import AppShell from "@/components/AppShell";
import ProjectsTable from "@/components/projects/ProjectsTable";

export default function ProjectsOldPage() {
  return (
    <AppShell>
      <div className="px-3 py-4 md:px-6 md:py-6" style={{ overflowX: "hidden" }}>
        <ProjectsTable />
      </div>
    </AppShell>
  );
}
