import AppShell from "@/components/AppShell";
import TeamPage from "@/components/team/TeamPage";

export const metadata = { title: "צוות — Redbloods OS" };

export default function TeamRoute() {
  return (
    <AppShell>
      <TeamPage />
    </AppShell>
  );
}
