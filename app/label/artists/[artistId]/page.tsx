import AppShell from "@/components/AppShell";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Per-artist page — reachable from the artist cards on /label.
// Phase 1 is focused on the main label dashboard; this is an intentional stub.
export default async function Page({ params }: { params: Promise<{ artistId: string }> }) {
  const { artistId } = await params;
  const name = decodeURIComponent(artistId);
  return (
    <AppShell>
      <div dir="rtl" style={{ padding: "40px 24px", maxWidth: 720, margin: "0 auto", fontFamily: "'Heebo', Arial, sans-serif" }}>
        <Link href="/label" style={{ color: "#DC2626", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>← חזרה לניהול הלייבל</Link>
        <div style={{
          marginTop: 20, padding: "32px 28px", borderRadius: 18,
          background: "#181818", border: "1px solid rgba(255,255,255,0.07)", textAlign: "center",
        }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#F2F2F2" }}>{name}</div>
          <div style={{ marginTop: 10, fontSize: 14, color: "#A0A0A0", lineHeight: 1.7 }}>
            עמוד האמן המפורט יגיע בשלב הבא.<br />
            כרגע ניהול הריליסים מתבצע מהמסך הראשי של ניהול הלייבל.
          </div>
        </div>
      </div>
    </AppShell>
  );
}
