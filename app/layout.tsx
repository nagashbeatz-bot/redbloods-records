import type { Metadata } from "next";
import "./globals.css";
import ProjectsProvider from "@/components/ProjectsProvider";
import PlayerProvider from "@/components/PlayerProvider";

export const metadata: Metadata = {
  title: "Redbloods Records",
  description: "מערכת ניהול פנימית — Redbloods Records",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen" suppressHydrationWarning>
        <ProjectsProvider>
          <PlayerProvider>
            {children}
          </PlayerProvider>
        </ProjectsProvider>
      </body>
    </html>
  );
}
