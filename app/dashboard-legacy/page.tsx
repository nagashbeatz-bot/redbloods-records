// /dashboard-legacy — the dashboard that was /dashboard until 2026-10-01 (Owner decision: Dashboard V2 became the main
// dashboard). Kept intact as a technical backup only; not linked from the sidebar.
import AppShell from "@/components/AppShell";
import DashboardDesignPreview from "@/components/dashboard/DashboardDesignPreview";

export const dynamic = "force-dynamic";

export default function DashboardLegacyPage() {
  return (
    <AppShell>
      <DashboardDesignPreview />
    </AppShell>
  );
}
