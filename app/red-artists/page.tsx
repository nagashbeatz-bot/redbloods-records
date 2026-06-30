import AppShell from "@/components/AppShell";
import ArtistPortalPage from "@/components/red-artists/ArtistPortalPage";

export const metadata = { title: "Red Artists — פורטל אמן | Redbloods OS" };

export default function RedArtistsPage() {
  return (
    <AppShell>
      <ArtistPortalPage />
    </AppShell>
  );
}
