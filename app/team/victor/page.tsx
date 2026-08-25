import { Suspense } from "react";
import AppShell from "@/components/AppShell";
import VictorProfilePage from "@/components/team/VictorProfilePage";

export const metadata = { title: "Victor — פרופיל ספק | Redbloods OS" };

export default function VictorPage() {
  return (
    <AppShell>
      {/* Suspense is what useSearchParams() needs on this statically rendered
          route (the ?workId= deep-link reads it). fallback={null} on purpose:
          the page already renders its own loading state once mounted, so an
          extra placeholder here would only add a flash. */}
      <Suspense fallback={null}>
        <VictorProfilePage />
      </Suspense>
    </AppShell>
  );
}
