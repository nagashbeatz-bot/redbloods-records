/**
 * Redbloods Partner — canonical serialization + SHA-256 for Action snapshots
 * (Phase F.1H). Pure, deterministic, no I/O.
 *
 * The Owner approves an exact structured proposal; its integrity identity is
 * SHA-256(canonicalStableStringify(snapshot)) — 64 lowercase hex, matching the
 * DB CHECK on partner_action_events.snapshot_hash. This is deliberately NOT the
 * 16-hex Case fingerprint (feedback/snapshot.ts), which serves a different
 * purpose and stays unchanged.
 *
 * canonicalStableStringify is strict: object keys are sorted recursively,
 * array order is preserved, and anything that is not plain JSON data is
 * rejected (undefined, Date, function, symbol, bigint, NaN / ±Infinity,
 * class instances / Map / Set / RegExp …) instead of being silently coerced.
 */
import { createHash } from "node:crypto";

export class CanonicalSerializationError extends Error {
  constructor(readonly path: string, reason: string) {
    super(`canonical serialization rejected ${path || "<root>"}: ${reason}`);
    this.name = "CanonicalSerializationError";
  }
}

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function encode(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string": return JSON.stringify(value);
    case "boolean": return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalSerializationError(path, "non-finite number");
      return JSON.stringify(value);
    case "undefined": throw new CanonicalSerializationError(path, "undefined");
    case "function": throw new CanonicalSerializationError(path, "function");
    case "symbol": throw new CanonicalSerializationError(path, "symbol");
    case "bigint": throw new CanonicalSerializationError(path, "bigint");
  }
  const obj = value as object;
  if (Array.isArray(obj)) {
    const parts: string[] = [];
    for (let i = 0; i < obj.length; i++) {
      if (!(i in obj)) throw new CanonicalSerializationError(`${path}[${i}]`, "sparse array hole");
      parts.push(encode(obj[i], `${path}[${i}]`));
    }
    return `[${parts.join(",")}]`;
  }
  if (obj instanceof Date) throw new CanonicalSerializationError(path, "Date (store an ISO string instead)");
  if (!isPlainObject(obj)) throw new CanonicalSerializationError(path, `non-plain object (${obj.constructor?.name ?? "unknown"})`);
  if (Object.getOwnPropertySymbols(obj).length) throw new CanonicalSerializationError(path, "symbol-keyed property");
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${encode((obj as Record<string, unknown>)[k], path ? `${path}.${k}` : k)}`).join(",")}}`;
}

/** Deterministic JSON text: recursively sorted keys, arrays in order, strict plain-data only. */
export function canonicalStableStringify(value: unknown): string {
  return encode(value, "");
}

export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** SHA-256 of the UTF-8 bytes of the canonical text, 64 lowercase hex. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function canonicalSha256(value: unknown): string {
  return sha256Hex(canonicalStableStringify(value));
}
