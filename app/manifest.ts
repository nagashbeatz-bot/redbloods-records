import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Redbloods Records",
    short_name: "Redbloods",
    description: "מערכת ניהול פנימית — Redbloods Records",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0D0D0D",
    theme_color: "#0D0D0D",
    orientation: "portrait",
    icons: [
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
