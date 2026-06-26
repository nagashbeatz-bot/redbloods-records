import AppShell from "@/components/AppShell";
import SocialDesignPreview from "@/components/social/SocialDesignPreview";
import QuickActionsButton from "@/components/quick-actions/QuickActionsButton";

export default function SocialPreviewPage() {
  return (
    <AppShell topRight={<QuickActionsButton />}>
      <SocialDesignPreview />
    </AppShell>
  );
}
