import AppShell from "@/components/AppShell";
import ShowsHubPreview from "@/components/shows/ShowsHubPreview";

export const metadata = { title: "הופעות — Redbloods OS" };

export default function ShowsRoute() {
  return (
    <AppShell>
      <ShowsHubPreview />
    </AppShell>
  );
}
