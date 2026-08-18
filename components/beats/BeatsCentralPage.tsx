"use client";

import { BeatsPage } from "@/components/red-artists/ArtistPortalPage";

/**
 * The owner's central beat repository. Deliberately the SAME list component the
 * artist portals use (list / genre / key / created-at / play / upload) — one
 * implementation, so the two views can never drift apart. Passing no artistSlug
 * is what makes this the unfiltered repository; an upload from here creates one
 * central beat and assigns it to nobody.
 */
export default function BeatsCentralPage() {
  return (
    <div dir="rtl" style={{ padding: "22px 20px 40px", maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: "#F2F2F2", margin: 0, display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ color: "#DC2626" }}>♫</span> ביטים
        </h1>
        <div style={{ fontSize: 13, color: "#A0A0A0", marginTop: 5 }}>
          המאגר המרכזי של Redbloods — כל הביטים במקום אחד
        </div>
      </div>
      <BeatsPage />
    </div>
  );
}
