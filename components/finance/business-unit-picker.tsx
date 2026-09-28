"use client";
/**
 * Business unit (task 4, 2026-09-28) — the ONE client helper every screen that creates a Finance row uses.
 *
 * The server decides the unit by lib/business-unit's rule. When no unit is certain, a MANUAL create is refused with 422
 * NEEDS_BUSINESS_UNIT: `postTransactionWithUnit` then asks the person (Studio / Records / Films / Corporate) and sends the
 * same request again with the chosen unit (recorded as the Owner's decision). Closing the picker saves nothing.
 * Corporate is an explicit choice only — never a default.
 */
import { BUSINESS_UNITS, BUSINESS_UNIT_HE, type BusinessUnit } from "@/lib/business-unit";

/** The same request with `businessUnit` added to its JSON body (no unit → unchanged). */
export function withBusinessUnit(init: RequestInit, unit?: string | null): RequestInit {
  if (!unit || typeof init.body !== "string") return init;
  try { return { ...init, body: JSON.stringify({ ...JSON.parse(init.body), businessUnit: unit }) }; } catch { return init; }
}

const UNIT_HINT_HE: Readonly<Record<BusinessUnit, string>> = {
  STUDIO: "לקוחות אודיו, הפקה, הקלטה, מיקס / מאסטר, Victor",
  RECORDS: "אמני הלייבל, הופעות, ריליסים, קידום, השקעה באמנים",
  FILMS: "וידאו / קליפים ללקוחות חיצוניים",
  CORPORATE: "הוצאה של כל Redbloods — רק אם זה באמת כלל-חברתי",
};

/** A small modal: resolves the chosen unit, or null when closed (nothing is saved). */
export function askBusinessUnit(reasonHe: string, title = "לאיזו יחידה שייכת הרשומה?"): Promise<BusinessUnit | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") { resolve(null); return; }
    const overlay = document.createElement("div");
    overlay.setAttribute("dir", "rtl");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    Object.assign(overlay.style, { boxSizing: "border-box", position: "fixed", top: "0", right: "0", bottom: "0", left: "0", zIndex: "10000", background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", fontFamily: "inherit" });
    const box = document.createElement("div");
    Object.assign(box.style, { boxSizing: "border-box", background: "#161617", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px", padding: "20px", width: "100%", maxWidth: "420px", minWidth: "0", margin: "0 auto", color: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" });
    const h = document.createElement("div");
    h.textContent = title;
    Object.assign(h.style, { fontSize: "17px", fontWeight: "900", marginBottom: "6px" });
    const p = document.createElement("div");
    p.textContent = reasonHe ? reasonHe.replace(/^יש לבחור יחידה עסקית[^—]*—\s*/, "") : "אין סיווג ודאי לרשומה הזו — בחר יחידה.";
    Object.assign(p.style, { fontSize: "12.5px", color: "#A1A1AA", lineHeight: "1.6", marginBottom: "14px" });
    box.append(h, p);
    const done = (u: BusinessUnit | null) => { document.removeEventListener("keydown", onKey); overlay.remove(); resolve(u); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") done(null); };
    for (const u of BUSINESS_UNITS) {
      const b = document.createElement("button");
      b.type = "button";
      Object.assign(b.style, { boxSizing: "border-box", display: "block", width: "100%", textAlign: "right", padding: "11px 14px", marginBottom: "8px", borderRadius: "12px", cursor: "pointer", fontFamily: "inherit", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff" });
      const name = document.createElement("div"); name.textContent = BUSINESS_UNIT_HE[u]; Object.assign(name.style, { fontSize: "14.5px", fontWeight: "800" });
      const hint = document.createElement("div"); hint.textContent = UNIT_HINT_HE[u]; Object.assign(hint.style, { fontSize: "11.5px", color: "#A1A1AA", marginTop: "2px" });
      b.append(name, hint);
      b.onclick = () => done(u);
      box.append(b);
    }
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.textContent = "ביטול — לא לשמור";
    Object.assign(cancel.style, { boxSizing: "border-box", width: "100%", padding: "10px", borderRadius: "12px", cursor: "pointer", fontFamily: "inherit", background: "transparent", border: "none", color: "#A1A1AA", fontSize: "13px", marginTop: "2px" });
    cancel.onclick = () => done(null);
    box.append(cancel);
    overlay.append(box);
    overlay.onclick = (e) => { if (e.target === overlay) done(null); };
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);
  });
}

/**
 * Send a transaction create; when the server needs a unit (422 NEEDS_BUSINESS_UNIT) ask for it and send again.
 * Returns the last response (a closed picker returns the original 422 — nothing was saved).
 */
export async function postTransactionWithUnit(send: (unit?: string) => Promise<Response>): Promise<Response> {
  const res = await send();
  if (res.status !== 422) return res;
  let info: { code?: string; reasonHe?: string } | null = null;
  try { info = await res.clone().json(); } catch { info = null; }
  if (info?.code !== "NEEDS_BUSINESS_UNIT") return res;
  const unit = await askBusinessUnit(String(info.reasonHe ?? ""));
  if (!unit) return res;
  return send(unit);
}
