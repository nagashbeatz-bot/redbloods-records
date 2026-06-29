import AppShell from "@/components/AppShell";
import StevenProfilePage from "@/components/team/StevenProfilePage";

export const metadata = { title: "Steven — פרופיל ספק | Redbloods OS" };

export default function StevenPage() {
  return (
    <AppShell>
      <StevenProfilePage />
    </AppShell>
  );
}
