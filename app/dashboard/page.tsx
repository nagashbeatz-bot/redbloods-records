import AppShell from "@/components/AppShell";
import DashboardV2 from "@/components/dashboard-v2/DashboardV2";

export const dynamic = "force-dynamic";

// The main dashboard = Dashboard V2 (Owner decision 2026-10-01). The previous dashboard is kept intact at
// /dashboard-legacy (backup); /dashboard-v2 stays a temporary alias of this page; /dashboard-old is unrelated.
export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardV2 />
    </AppShell>
  );
}
