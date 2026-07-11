import AppShell from "@/components/AppShell";
import ArtistPage from "@/components/label/ArtistPage";
import ArtistPortalPage from "@/components/red-artists/ArtistPortalPage";
import { getLabelArtist } from "@/lib/label-artists-store";

export const dynamic = "force-dynamic";

// Artists that have a dedicated portal (matched server-side by the DB record,
// never by a client-sent param or a UI hardcode). Interim: Shalev by name.
const PORTAL_ARTIST_NAME = "שליו טסמה";

export default async function Page({ params }: { params: Promise<{ artistId: string }> }) {
  const { artistId } = await params;

  // Resolve the artist from the DB by the received id, then decide server-side
  // which view to render. Shalev → the existing portal (unchanged); anyone else
  // → the label release-management ArtistPage as a fallback.
  let isPortalArtist = false;
  try {
    const artist = await getLabelArtist(artistId);
    isPortalArtist = artist?.name === PORTAL_ARTIST_NAME;
  } catch {
    isPortalArtist = false;
  }

  return (
    <AppShell>
      {isPortalArtist ? <ArtistPortalPage /> : <ArtistPage artistId={artistId} />}
    </AppShell>
  );
}
