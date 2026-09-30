import AppShell from "@/components/AppShell";
import DashboardV2 from "@/components/dashboard-v2/DashboardV2";

export const dynamic = "force-dynamic";

// Dashboard V2 — built beside the current /dashboard (unchanged) until the Owner approves the switch.
export default function DashboardV2Page() {
  return (
    <AppShell>
      <DashboardV2 />
    </AppShell>
  );
}
