import AppShell from "@/components/AppShell";
import RedFilmProductionPage from "@/components/red-films/RedFilmProductionPage";

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const { id } = await params;
  return (
    <AppShell>
      <RedFilmProductionPage id={id} />
    </AppShell>
  );
}
