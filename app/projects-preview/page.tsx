import AppShell from "@/components/AppShell";
import ProjectsDesignPreview from "@/components/projects/ProjectsDesignPreview";
import QuickActionsButton from "@/components/quick-actions/QuickActionsButton";

export default function ProjectsPreviewPage() {
  return (
    <AppShell topRight={<QuickActionsButton />}>
      <ProjectsDesignPreview />
    </AppShell>
  );
}
