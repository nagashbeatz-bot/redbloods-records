import AppShell from "@/components/AppShell";
import ArtistPage from "@/components/label/ArtistPage";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ artistId: string }> }) {
  const { artistId } = await params;
  return (
    <AppShell>
      <ArtistPage artistId={artistId} />
    </AppShell>
  );
}
