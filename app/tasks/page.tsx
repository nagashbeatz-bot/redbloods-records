import AppShell from "@/components/AppShell";
import TasksPage from "@/components/tasks/TasksPage";

export default function Page() {
  return (
    <AppShell>
      <div className="px-3 py-4 md:px-6 md:py-6" style={{ overflowX: "hidden" }}>
        <TasksPage />
      </div>
    </AppShell>
  );
}
