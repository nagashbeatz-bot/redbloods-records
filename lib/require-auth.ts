import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";
import { roleForEmail, type UserRole } from "@/lib/roles";

/** Returns the authenticated Supabase user, or null when not signed in. */
export async function getAuthUser() {
  try {
    const supabase = await createSupabaseServer();
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  } catch {
    return null;
  }
}

/** Returns the authenticated user's role (owner | victor | unknown), or null when not signed in. */
export async function getAuthRole(): Promise<UserRole | null> {
  const user = await getAuthUser();
  if (!user) return null;
  return roleForEmail(user.email);
}

const UNAUTH = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });
const FORBID = () => NextResponse.json({ error: "forbidden" }, { status: 403 });

/**
 * Defense-in-depth guards for API route handlers. The proxy (proxy.ts) is the
 * primary gate; these re-check the session/role per route so a matcher change
 * can never silently expose an endpoint.
 *   401 = not signed in · 403 = signed in but not authorized.
 *
 * Usage:  const denied = await requireOwner(); if (denied) return denied;
 */

/** Any signed-in, recognized user (owner or victor). */
export async function requireAuth(): Promise<NextResponse | null> {
  const role = await getAuthRole();
  if (role === null) return UNAUTH();
  if (role === "unknown") return FORBID();
  return null;
}

/** Owner only — Victor and unknown users get 403. */
export async function requireOwner(): Promise<NextResponse | null> {
  const role = await getAuthRole();
  if (role === null) return UNAUTH();
  if (role !== "owner") return FORBID();
  return null;
}

/** Victor (or owner) — used on the scoped supplier endpoints. */
export async function requireVictorAccess(): Promise<NextResponse | null> {
  const role = await getAuthRole();
  if (role === null) return UNAUTH();
  if (role !== "owner" && role !== "victor") return FORBID();
  return null;
}
