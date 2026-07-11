import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import ArtistPortalPage from "@/components/red-artists/ArtistPortalPage";
import { getLabelArtistByName } from "@/lib/label-artists-store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Red Artists — פורטל אמן | Redbloods OS" };

const PORTAL_ARTIST_NAME = "שליו טסמה";

// Backward-compat: the artist page now lives under /label/artists/[id]. Resolve
// Shalev's id server-side and redirect there. If he isn't found (or a DB glitch),
// fall back to rendering the existing portal so the old URL never breaks.
export default async function RedArtistsPage() {
  let shalevId: string | null = null;
  try {
    const shalev = await getLabelArtistByName(PORTAL_ARTIST_NAME);
    shalevId = shalev?.id ?? null;
  } catch {
    shalevId = null;
  }

  if (shalevId) redirect(`/label/artists/${shalevId}`); // throws NEXT_REDIRECT — must stay outside try

  return (
    <AppShell>
      <ArtistPortalPage />
    </AppShell>
  );
}
