/**
 * Sunny Social Intelligence — the exact identity of a published post, as a HASH (never the link itself). A Redbloods content
 * item's posted URL and a Brain content resource's canonical URL match only when their canonical forms (the Brain's own
 * canonicalUrl mirror) are identical; the hash lets Sunny compare them without the link ever leaving the reader. Server-only.
 */
import { createHash } from "node:crypto";
import { canonicalUrl } from "../brain/url";

export function postHashOf(url: string | null | undefined): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  const c = canonicalUrl(url.trim());
  return c ? createHash("sha256").update(`redbloods-post-v1:${c}`).digest("hex").slice(0, 32) : null;
}
