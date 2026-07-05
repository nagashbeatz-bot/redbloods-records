import AppShell from "@/components/AppShell";
import StevenProfilePage from "@/components/team/StevenProfilePage";
import { getAuthRole } from "@/lib/require-auth";

export const metadata = { title: "Steven — פרופיל ספק | Redbloods OS" };

// Auth-gated, per-request page (reads the session), so it's dynamic anyway.
export const dynamic = "force-dynamic";

/**
 * Resolve the role ON THE SERVER from the session and pass it (+ the derived
 * language) into StevenProfilePage. This makes the VERY FIRST render — SSR and the
 * first client render — already role-correct, so Steven never sees even a frame of
 * the owner view / owner skeleton (permission flash), and owner never sees the
 * restricted one. The proxy already gated this route, so a real visitor here is
 * always "owner" or "steven"; anything else is treated as non-owner (safe).
 */
export default async function StevenPage() {
  const role = await getAuthRole();
  const initialRole = role === "steven" ? "steven" : role === "owner" ? "owner" : role === "victor" ? "victor" : null;
  const initialLang = initialRole === "steven" ? "en" : "he";
  return (
    <AppShell>
      <StevenProfilePage initialRole={initialRole} initialLang={initialLang} />
    </AppShell>
  );
}
