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
import { VICTOR_PRIMITIVES } from "./victor";
import { LABEL_PRIMITIVES } from "./label";
import { RF_PRIMITIVES } from "./redfilms";
import { WORKLOG_PRIMITIVES } from "./worklog";
import { DELIVERY_PRIMITIVES } from "./delivery";
import { SOCIAL_PRIMITIVES } from "./social";
import { SYSTEM_PRIMITIVES } from "./system";
import { FILES_PRIMITIVES } from "./files";
import { BACKFILL_PRIMITIVES } from "./backfills";

export * from "./core";
export { WAVE1_PRIMITIVES } from "./wave1";

export const ALL_PRIMITIVES: readonly PrimitiveSpec[] = [...WAVE1_PRIMITIVES, ...PROJECT_PRIMITIVES, ...CRM_PRIMITIVES, ...SESSION_PRIMITIVES, ...FINANCE_PRIMITIVES, ...SHOW_PRIMITIVES, ...MIX_PRIMITIVES, ...VICTOR_PRIMITIVES, ...LABEL_PRIMITIVES, ...RF_PRIMITIVES, ...WORKLOG_PRIMITIVES, ...DELIVERY_PRIMITIVES, ...SOCIAL_PRIMITIVES, ...SYSTEM_PRIMITIVES, ...FILES_PRIMITIVES, ...BACKFILL_PRIMITIVES];
export const PRIMITIVES_BY_ID: ReadonlyMap<string, PrimitiveSpec> = new Map(ALL_PRIMITIVES.map((p) => [p.actionId, p]));
