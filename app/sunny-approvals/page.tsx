import AppShell from "@/components/AppShell";
import SunnyApprovals from "@/components/partner/SunnyApprovals";

export default function Page() {
  return (
    <AppShell>
      <div className="px-3 py-4 md:px-6 md:py-6" style={{ overflowX: "hidden" }}>
        <SunnyApprovals />
      </div>
    </AppShell>
  );
}
