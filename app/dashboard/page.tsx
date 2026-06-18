import DashboardDesignPreview from "@/components/dashboard/DashboardDesignPreview";
import GlobalProjectDrawerProvider from "@/components/GlobalProjectDrawer";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <GlobalProjectDrawerProvider>
      <DashboardDesignPreview />
    </GlobalProjectDrawerProvider>
  );
}
