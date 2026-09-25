/**
 * Service-to-service authentication for the Sunny connector → Redbloods MAIN internal calendar read.
 * A dedicated secret (env PARTNER_INTERNAL_SERVICE_SECRET) — never the Owner session, never a Google token.
 * Constant-time comparison (hash both sides, timingSafeEqual). The secret is never logged, returned or served.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const INTERNAL_AUTH_HEADER = "x-redbloods-internal-auth";
export const INTERNAL_SECRET_ENV = "PARTNER_INTERNAL_SERVICE_SECRET";
export const MIN_SECRET_LENGTH = 32;

export type InternalAuthResult = "OK" | "MISSING" | "INVALID" | "NOT_CONFIGURED";

export function verifyInternalAuth(presented: string | null | undefined, configured: string | null | undefined): InternalAuthResult {
  if (!configured || configured.length < MIN_SECRET_LENGTH) return "NOT_CONFIGURED";
  if (!presented) return "MISSING";
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(configured, "utf8").digest();
  return timingSafeEqual(a, b) ? "OK" : "INVALID";
}
