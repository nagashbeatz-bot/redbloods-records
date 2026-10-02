/**
 * Sunny Brain — the TypeScript mirror of public.sunny_canonical_url (Brain v1, applied). Pure.
 * Must return the IDENTICAL string (or null) as the SQL function — proven by scripts/test-sunny-brain.tsx (cases verified
 * against the SQL function on the local Postgres harness). The DB re-checks every URL itself (CHECK = canonical form);
 * this mirror only lets Sunny / the dashboard build and preview the exact value before a write.
 */
const GENERIC = ["fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "ttclid", "twclid", "igshid", "igsh", "mc_cid", "mc_eid", "_ga", "_gl"];
const BY_HOST: Array<[string[], string[]]> = [
  [["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"], ["si", "feature", "pp"]],
  [["open.spotify.com"], ["si", "nd"]],
  [["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"], ["s", "t", "ref_src", "ref_url"]],
  [["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com"], ["is_from_webapp", "sender_device", "is_copy_url", "_r", "_t", "web_id", "share_app_id", "share_link_id", "u_code", "tt_from", "sec_user_id", "social_sharing"]],
  [["facebook.com", "www.facebook.com", "m.facebook.com"], ["mibextid", "rdid"]],
];
const charLen = (s: string) => [...s].length;
export function canonicalUrl(input: string): string | null {
  if (charLen(input) > 500 || /[\s\p{Cc}<>"\\^`{|}]/u.test(input)) return null;
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#[\s\S]*)?$/.exec(input);
  if (!m || m[1].toLowerCase() !== "https") return null;
  let host = m[2].toLowerCase();
  if (host === "" || host.includes("@")) return null;
  host = host.replace(/:443$/, "").replace(/\.(:[0-9]+)?$/, "$1");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$/.test(host)) return null;
  const path = m[3] === "" ? "/" : m[3];
  const drop = new Set([...GENERIC, ...(BY_HOST.find(([hosts]) => hosts.includes(host))?.[1] ?? [])]);
  const kept = m[4] === undefined ? [] : m[4].slice(1).split("&").filter((seg) => {
    const name = seg.split("=")[0];
    return seg !== "" && name !== "" && !name.toLowerCase().startsWith("utm_") && !drop.has(name.toLowerCase());
  });
  const frag = m[5] !== undefined && /^#[/!]/.test(m[5]) ? m[5] : "";
  return `https://${host}${path}${kept.length ? "?" + kept.join("&") : ""}${frag}`;
}
