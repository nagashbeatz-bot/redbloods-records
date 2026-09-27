import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getMaintenance } from "@/lib/maintenance";
import { setMaintenanceChecked } from "@/lib/writes/system";

/**
 * Maintenance lock — owner only.
 *   GET  → { enabled }         (current state)
 *   POST { enabled: boolean }  → toggle
 * The only way maintenance_mode is ever changed. Non-owner is 403 at the route
 * (requireOwner) — and never reaches it anyway once maintenance is on.
 */
export async function GET() {
  const denied = await requireOwner(); if (denied) return denied;
  return NextResponse.json({ enabled: await getMaintenance() });
}

export async function POST(req: Request) {
  const denied = await requireOwner(); if (denied) return denied;
  let enabled = false;
  try { enabled = !!(await req.json())?.enabled; } catch { /* default false */ }
  await setMaintenanceChecked(enabled); // shared writer — a failed write is an error
  return NextResponse.json({ ok: true, enabled });
}
