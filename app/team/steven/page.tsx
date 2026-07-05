import AppShell from "@/components/AppShell";
import StevenProfilePage from "@/components/team/StevenProfilePage";
import { getAuthRole } from "@/lib/require-auth";

export const metadata = { title: "Steven — פרופיל ספק | Redbloods OS" };

// Auth-gated, per-request page (reads the session), so it's dynamic anyway.
export const dynamic = "force-dynamic";

/**
 * Decide the page language ON THE SERVER from the session role, so the very first
 * SSR HTML is already correct — Steven → English, owner → Hebrew — with no
 * client-side Hebrew→English flash. The client still lets either role toggle and
 * persists the choice (rb_steven_lang) over this default.
 */
export default async function StevenPage() {
  const role = await getAuthRole();
  const initialLang = role === "steven" ? "en" : "he";
  return (
    <AppShell>
      <StevenProfilePage initialLang={initialLang} />
    </AppShell>
  );
}
