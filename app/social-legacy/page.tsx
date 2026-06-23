import AppShell from "@/components/AppShell";
import SocialListPage from "@/components/social/SocialListPage";

export default function SocialLegacyPage() {
  return (
    <AppShell>
      <div className="px-3 py-4 md:px-6 md:py-6" style={{ overflowX: "hidden" }}>
        <SocialListPage />
      </div>
    </AppShell>
  );
}
