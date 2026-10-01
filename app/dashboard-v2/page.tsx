import AppShell from "@/components/AppShell";
import DashboardV2 from "@/components/dashboard-v2/DashboardV2";

export const dynamic = "force-dynamic";

// Temporary alias of /dashboard (Dashboard V2 is the main dashboard since 2026-10-01) — kept so existing links keep working.
export default function DashboardV2Page() {
  return (
    <AppShell>
      <DashboardV2 />
    </AppShell>
  );
}
