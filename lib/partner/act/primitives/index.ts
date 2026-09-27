/**
 * SUNNY UNIVERSAL ACTION LAYER — every registered typed primitive (one list; the registry builds READY contracts from it).
 */
import type { PrimitiveSpec } from "./core";
import { WAVE1_PRIMITIVES } from "./wave1";
import { PROJECT_PRIMITIVES } from "./projects";
import { CRM_PRIMITIVES } from "./crm";
import { SESSION_PRIMITIVES } from "./sessions";
import { FINANCE_PRIMITIVES } from "./finance";
import { SHOW_PRIMITIVES } from "./shows";
import { MIX_PRIMITIVES } from "./mix";

export * from "./core";
export { WAVE1_PRIMITIVES } from "./wave1";

export const ALL_PRIMITIVES: readonly PrimitiveSpec[] = [...WAVE1_PRIMITIVES, ...PROJECT_PRIMITIVES, ...CRM_PRIMITIVES, ...SESSION_PRIMITIVES, ...FINANCE_PRIMITIVES, ...SHOW_PRIMITIVES, ...MIX_PRIMITIVES];
export const PRIMITIVES_BY_ID: ReadonlyMap<string, PrimitiveSpec> = new Map(ALL_PRIMITIVES.map((p) => [p.actionId, p]));
