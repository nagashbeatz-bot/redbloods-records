import AppShell from "@/components/AppShell";
import ProjectsTable from "@/components/projects/ProjectsTable";

export default function ProjectsPage() {
  return (
    <AppShell>
      <div className="px-3 py-4 md:px-6 md:py-8 max-w-6xl mx-auto" style={{ overflowX: "hidden" }}>
        <div className="mb-5 md:mb-8">
          <h1 className="text-xl md:text-2xl font-bold" style={{ color: "#F0F0F0" }}>
            פרויקטים
          </h1>
          <p className="text-sm mt-1" style={{ color: "#888" }}>
            כל הפרויקטים מהבורד ״שירים״ במאנדיי
          </p>
        </div>
        <ProjectsTable />
      </div>
    </AppShell>
  );
}
