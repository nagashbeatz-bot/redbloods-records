import AppShell from "@/components/AppShell";
import ShowsPage from "@/components/shows/ShowsPage";

export const metadata = { title: "הופעות (ישן) — Redbloods OS" };

export default function ShowsLegacyRoute() {
  return (
    <AppShell>
      <ShowsPage />
    </AppShell>
  );
}
