"use client";

import { useEffect, useState } from "react";
import { BeatsPage } from "@/components/red-artists/ArtistPortalPage";

// Same ≤640px breakpoint the list itself uses, so the two never disagree about
// which layout is on screen.
function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const check = () => setM(window.innerWidth <= 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return m;
}

/**
 * The owner's central beat repository. Deliberately the SAME list component the
 * artist portals use (list / genre / key / created-at / play / upload) — one
 * implementation, so the two views can never drift apart. Passing no artistSlug
 * is what makes this the unfiltered repository; an upload from here creates one
 * central beat and assigns it to nobody.
 */
export default function BeatsCentralPage() {
  const isMobile = useIsMobile();
  return (
    // Desktop keeps the heading tighter and the bottom gutter smaller: every
    // pixel spent here is a beat row the list can no longer show above the fold.
    <div dir="rtl" style={{ padding: isMobile ? "22px 20px 40px" : "14px 20px 22px", maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ marginBottom: isMobile ? 18 : 10 }}>
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
