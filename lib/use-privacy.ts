"use client";

/**
 * Privacy Mode / "מצב לקוח" — a display-only global toggle that hides financial
 * values in the UI when a client is nearby. Persisted in localStorage only; it
 * never touches data, calculations, formatters, permissions, or routing.
 */
import { useEffect, useLayoutEffect, useState } from "react";

const KEY = "rb_privacy";
const EVENT = "rb:privacy";

// Runs before paint on the client (so amounts never flash before masking);
// falls back to useEffect on the server.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function readPrivacy(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    return false; // any localStorage problem → default OFF (show money)
  }
}

export function setPrivacy(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "true" : "false");
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
  }
}

/**
 * Returns [hidden, toggle]. `hidden` is true while client mode is active.
 * All consumers stay in sync via the rb:privacy event (and cross-tab storage).
 */
export function usePrivacyMode(): [boolean, () => void] {
  const [hidden, setHidden] = useState(false);

  // Hydrate from localStorage before paint.
  useIsoLayoutEffect(() => {
    setHidden(readPrivacy());
  }, []);

  useEffect(() => {
    const onEvt = (e: Event) => setHidden(!!(e as CustomEvent<boolean>).detail);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setHidden(e.newValue === "true");
    };
    window.addEventListener(EVENT, onEvt);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onEvt);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const toggle = () => setPrivacy(!readPrivacy());
  return [hidden, toggle];
}
