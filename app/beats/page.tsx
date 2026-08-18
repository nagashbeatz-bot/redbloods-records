import AppShell from "@/components/AppShell";
import BeatsCentralPage from "@/components/beats/BeatsCentralPage";

export const dynamic = "force-dynamic";

/**
 * /beats — the owner's central beat repository (every row in public.beats).
 * Artist portals render the SAME list component scoped to their own assigned
 * beats; this page passes no scope, so it shows the whole repository.
 */
export default function Page() {
  return (
    <AppShell>
      <BeatsCentralPage />
    </AppShell>
  );
}
