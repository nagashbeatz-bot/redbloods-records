import type { Metadata } from "next";
import "./globals.css";
import ProjectsProvider from "@/components/ProjectsProvider";
import PlayerProvider from "@/components/PlayerProvider";
import RadioProvider from "@/components/radio/RadioProvider";

export const metadata: Metadata = {
  title: "Redbloods Records",
  description: "מערכת ניהול פנימית — Redbloods Records",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Redbloods",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
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
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0D0D0D" />
        <link rel="apple-touch-icon" href="/apple-icon.png" />
      </head>
      <body className="min-h-screen" suppressHydrationWarning>
        <ProjectsProvider>
          <PlayerProvider>
            <RadioProvider>
              {children}
            </RadioProvider>
          </PlayerProvider>
        </ProjectsProvider>
      </body>
    </html>
  );
}
