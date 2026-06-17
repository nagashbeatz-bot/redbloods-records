import AppShell from "@/components/AppShell";
import CampaignPage from "@/components/social/CampaignPage";

export default async function Page({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  return (
    <AppShell>
      <div className="px-3 py-4 md:px-6 md:py-6" style={{ overflowX: "hidden" }}>
        <CampaignPage campaignId={campaignId} />
      </div>
    </AppShell>
  );
}
