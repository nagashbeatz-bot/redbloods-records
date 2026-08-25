import AppShell from "@/components/AppShell";
import DashboardDesignPreview from "@/components/dashboard/DashboardDesignPreview";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardDesignPreview />
    </AppShell>
  );
}
