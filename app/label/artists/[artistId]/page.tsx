import AppShell from "@/components/AppShell";
import ArtistPage from "@/components/label/ArtistPage";
import ArtistPortalPage from "@/components/red-artists/ArtistPortalPage";
import { getLabelArtist } from "@/lib/label-artists-store";
import { isPortalArtistName } from "@/lib/red-artists/portal-config";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ artistId: string }> }) {
  const { artistId } = await params;

  // Resolve the artist from the DB by the received id, then decide server-side
  // which view to render. Any registered portal artist (lib/red-artists/portal-config.ts)
  // → the full ArtistPortalPage; anyone else → the label release-management
  // ArtistPage as a fallback.
  let isPortalArtist = false;
  let artistName: string | undefined;
  try {
    const artist = await getLabelArtist(artistId);
    artistName = artist?.name;
    isPortalArtist = isPortalArtistName(artistName);
  } catch {
    isPortalArtist = false;
  }

  return (
    <AppShell>
      {isPortalArtist
        ? <ArtistPortalPage artistId={artistId} artistName={artistName} />
        : <ArtistPage artistId={artistId} />}
    </AppShell>
  );
}
