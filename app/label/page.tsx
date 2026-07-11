import AppShell from "@/components/AppShell";
import LabelPage from "@/components/label/LabelPage";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AppShell>
      <LabelPage />
    </AppShell>
  );
}
