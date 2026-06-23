import AppShell from "@/components/AppShell";
import SocialDesignPreview from "@/components/social/SocialDesignPreview";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  return (
    <AppShell>
      <SocialDesignPreview campaignId={campaignId} />
    </AppShell>
  );
}
