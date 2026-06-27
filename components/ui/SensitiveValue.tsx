"use client";

/**
 * Masks an already-formatted value when Privacy Mode is on. Display-only — it
 * never alters the value, formatting, or calculation; it just swaps the
 * rendered text for "••••". inline-block + min-width keeps layout stable so the
 * page doesn't jump when toggling.
 */
import { usePrivacyMode } from "@/lib/use-privacy";

export default function SensitiveValue({
  children,
  mask = "••••",
}: {
  children: React.ReactNode;
  mask?: string;
}) {
  const [hidden] = usePrivacyMode();
  if (!hidden) return <>{children}</>;
  return (
    <span style={{ display: "inline-block", minWidth: "2.5ch", letterSpacing: "0.05em" }} aria-label="מוסתר">
      {mask}
    </span>
  );
}
