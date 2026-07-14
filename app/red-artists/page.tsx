import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import ArtistPortalPage from "@/components/red-artists/ArtistPortalPage";
import { getLabelArtistByName } from "@/lib/label-artists-store";
import { getAuthRole } from "@/lib/require-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Red Artists — פורטל אמן | Redbloods OS" };

const PORTAL_ARTIST_NAME = "שליו טסמה";

// Owner: the canonical artist page lives under /label/artists/[id] — resolve
// Shalev's id server-side and redirect there. Shalev (the artist role): render
// the portal IN PLACE — his portal is served on /red-artists and the proxy never
// lets him reach /label/*, so redirecting him would loop. initialRole is passed
// for flash-free, owner-only balance gating inside the portal.
export default async function RedArtistsPage() {
  const role = await getAuthRole();

  let shalevId: string | null = null;
  try {
    const shalev = await getLabelArtistByName(PORTAL_ARTIST_NAME);
    shalevId = shalev?.id ?? null;
  } catch {
    shalevId = null;
  }

  if (role !== "shalev" && shalevId) redirect(`/label/artists/${shalevId}`); // NEXT_REDIRECT — outside try

  const initialRole = role === "unknown" ? null : role;
  return (
    <AppShell>
      <ArtistPortalPage initialRole={initialRole} />
    </AppShell>
  );
}
