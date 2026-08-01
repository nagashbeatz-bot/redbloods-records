import AppShell from "@/components/AppShell";
import ArtistPage from "@/components/label/ArtistPage";
import ArtistPortalPage from "@/components/red-artists/ArtistPortalPage";
import { getLabelArtist } from "@/lib/label-artists-store";
import { isPortalArtistName } from "@/lib/red-artists/portal-config";
import { getAuthRole } from "@/lib/require-auth";

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

  // Role is passed to the portal for flash-free tab gating (Avi → 3 tabs). The
  // proxy already blocks Avi from any other artistId, so this is UI only.
  const role = await getAuthRole();
  const initialRole = role === "unknown" ? null : role;

  return (
    <AppShell>
      {isPortalArtist
        // key={artistId} forces a full unmount/remount when navigating between
        // two different artists' portals client-side (no full page reload) —
        // otherwise React would reuse the same component instance and every
        // local useState (sketches, ledger, nextWork, nextRelease, avatar…)
        // would keep showing the PREVIOUS artist's data until each fetch
        // effect happened to re-run and overwrite it.
        ? <ArtistPortalPage key={artistId} initialRole={initialRole} artistId={artistId} artistName={artistName} />
        : <ArtistPage artistId={artistId} />}
    </AppShell>
  );
}
