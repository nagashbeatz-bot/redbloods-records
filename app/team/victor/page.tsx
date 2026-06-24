import AppShell from "@/components/AppShell";
import VictorProfilePage from "@/components/team/VictorProfilePage";

export const metadata = { title: "Victor — פרופיל ספק | Redbloods OS" };

export default function VictorPage() {
  return (
    <AppShell>
      <VictorProfilePage />
    </AppShell>
  );
}
