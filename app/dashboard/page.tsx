import AppShell from "@/components/AppShell";
import DashboardDesignPreview from "@/components/dashboard/DashboardDesignPreview";
import GlobalProjectDrawerProvider from "@/components/GlobalProjectDrawer";
import QuickActionsButton from "@/components/quick-actions/QuickActionsButton";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <GlobalProjectDrawerProvider>
      <AppShell topRight={<QuickActionsButton />}>
        <DashboardDesignPreview />
      </AppShell>
    </GlobalProjectDrawerProvider>
  );
}
