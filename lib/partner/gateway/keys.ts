/**
 * Redbloods Partner — Gateway entity keys. Pure. (Split out of entity.ts so the knowledge layer can validate keys
 * without importing the entity views — no import cycle. Behaviour unchanged.)
 */
import type { GatewayEntityType } from "./types";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_RE = new RegExp(`^(project|client|label-artist|dj|show|session|release):(${UUID})$`);
const PERIOD_RE = /^recurring:VICTOR_SALARY:(\d{4}-(?:0[1-9]|1[0-2]))$/;

export function parseEntityKey(key: string): { type: GatewayEntityType; id: string } | null {
  const m = KEY_RE.exec(key);
  if (m) return { type: m[1] as GatewayEntityType, id: m[2] };
  if (key === "vendor:VICTOR" || key === "vendor:STEVEN") return { type: "vendor", id: key.slice(7) };
  const p = PERIOD_RE.exec(key);
  if (p) return { type: "recurring", id: p[1] };
  return null;
}
