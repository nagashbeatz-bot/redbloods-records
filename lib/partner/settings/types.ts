/**
 * Sunny SETTINGS source — typed shape (pure). One section per REGISTERED readable settings family
 * (lib/partner/system/settings.ts). Secret families are never present.
 */
import type { Maybe } from "../operations/types";

export interface SettingsRow { key: string; updatedAt: string | null; value: unknown }
export interface SettingsState { families: Record<string, Maybe<SettingsRow>> }
