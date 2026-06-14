import AppShell from "@/components/AppShell";
import ShowsPage from "@/components/shows/ShowsPage";

export const metadata = { title: "הופעות — Redbloods OS" };

export default function ShowsRoute() {
  return (
    <AppShell>
      <ShowsPage />
    </AppShell>
  );
}
