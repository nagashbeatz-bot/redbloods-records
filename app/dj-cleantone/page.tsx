import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import ArtistPortalPage from "@/components/red-artists/ArtistPortalPage";
import { getLabelArtistByName } from "@/lib/label-artists-store";
import { getAuthRole } from "@/lib/require-auth";
import { CLEANTONE_ARTIST_NAME } from "@/lib/red-artists/cleantone";

export const dynamic = "force-dynamic";
export const metadata = { title: "DJ CLEANTONE — פורטל | Redbloods OS" };

// Mirrors app/red-artists/page.tsx exactly: owner sees the canonical artist
// page under /label/artists/[id]; DJ CLEANTONE's own session renders the
// portal IN PLACE (served at /dj-cleantone; the proxy never lets him reach
// /label/*, so redirecting him would loop).
export default async function DjCleantonePage() {
  const role = await getAuthRole();

  let cleantoneId: string | null = null;
  try {
    const artist = await getLabelArtistByName(CLEANTONE_ARTIST_NAME);
    cleantoneId = artist?.id ?? null;
  } catch {
    cleantoneId = null;
  }

  if (role !== "cleantone" && cleantoneId) redirect(`/label/artists/${cleantoneId}`); // NEXT_REDIRECT — outside try

  const initialRole = role === "unknown" ? null : role;
  return (
    <AppShell>
      <ArtistPortalPage initialRole={initialRole} artistName={CLEANTONE_ARTIST_NAME} />
    </AppShell>
  );
}
