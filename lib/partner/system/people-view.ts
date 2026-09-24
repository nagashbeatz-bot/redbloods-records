/**
 * Sunny System Awareness — served (semantic) views + validation of the people / access / push contracts. Pure.
 * `internal` fields never leave this module's served views.
 */
import { PEOPLE_BASELINE_VERSION, PUSH_CONTRACTS, PUSH_MODULE_EXCLUSIONS, SECURITY_GAPS, USER_CONTRACTS, type PushContract, type UserContract } from "./people";

export { PEOPLE_BASELINE_VERSION, PUSH_CONTRACTS, PUSH_MODULE_EXCLUSIONS, SECURITY_GAPS, USER_CONTRACTS };
export type { PushContract, UserContract };

export const LOGIN_ROLES = ["owner", "shalev", "avi", "cleantone", "victor", "steven"] as const;

export const servedUser = (u: UserContract) => { const { internal: _i, ...rest } = u; void _i; return rest; };
export const servedPush = (p: PushContract) => { const { internal: _i, ...rest } = p; void _i; return rest; };

const PERSON_OF_ROLE: Record<string, string> = { owner: "OWNER", shalev: "SHALEV", avi: "AVI", cleantone: "CLEANTONE", victor: "VICTOR", steven: "STEVEN" };
export const personOfRole = (role: string) => PERSON_OF_ROLE[role] ?? null;

/** One row per person: what they see / can change / money / push — derived from the contracts (no second truth). */
export function accessMatrix() {
  return USER_CONTRACTS.map((u) => {
    const writes = u.tabs.flatMap((t) => t.writes.map((w) => ({ tab: t.id, ...w })));
    return {
      person: u.id, title: u.titleHe, kind: u.kind, landing: u.landing,
      pages: u.tabs.map((t) => t.titleHe),
      money: [...new Set(u.tabs.map((t) => t.money))].filter((m) => m !== "NONE"),
      canUpload: writes.some((w) => /upload/i.test(w.action)),
      canChangeStatus: u.kind === "LOGIN_ROLE" && (u.id === "OWNER" || writes.some((w) => /confirm|status|resolved/i.test(w.action))),
      canDelete: u.id === "OWNER" || writes.some((w) => /delete/i.test(w.action)),
      readOnly: u.kind === "LOGIN_ROLE" && writes.length === 0,
      ownerOnlyEverything: u.id === "OWNER",
      canSendPushManually: u.id === "OWNER",
      writes,
      receivesPush: u.receivesPush.length, triggersPush: u.triggersPush,
      securityGaps: u.securityGapIds,
    };
  });
}

export function validatePeopleContracts(): string[] {
  const e: string[] = [];
  const users = new Set<string>();
  const pushIds = new Set(PUSH_CONTRACTS.map((p) => p.id));
  const gapIds = new Set(SECURITY_GAPS.map((g) => g.id));
  if (pushIds.size !== PUSH_CONTRACTS.length) e.push("duplicate push id");
  if (gapIds.size !== SECURITY_GAPS.length) e.push("duplicate gap id");
  for (const u of USER_CONTRACTS) {
    if (!/^[A-Z][A-Z0-9_]{2,40}$/.test(u.id)) e.push(`${u.id}: bad id`);
    if (users.has(u.id)) e.push(`${u.id}: duplicate`);
    users.add(u.id);
    for (const p of [...u.receivesPush, ...u.triggersPush]) if (!pushIds.has(p)) e.push(`${u.id}: unknown push ${p}`);
    for (const g of u.securityGapIds) if (!gapIds.has(g)) e.push(`${u.id}: unknown gap ${g}`);
    if (u.kind === "LOGIN_ROLE" && (!u.internal.role || !u.landing)) e.push(`${u.id}: a login role needs its role + landing`);
  }
  for (const p of PUSH_CONTRACTS) {
    if (p.sunnyMayTrigger !== false) e.push(`${p.id}: Sunny may never trigger push`);
    if (!p.internal.modules.length) e.push(`${p.id}: no sender module`);
    for (const r of p.recipientRoles) {
      if (!(LOGIN_ROLES as readonly string[]).includes(r)) e.push(`${p.id}: unknown recipient role ${r}`);
      const person = USER_CONTRACTS.find((u) => u.internal.role === r);
      if (person && !person.receivesPush.includes(p.id)) e.push(`${p.id}: ${person.id} receives it but does not list it`);
    }
  }
  for (const u of USER_CONTRACTS) for (const pid of u.receivesPush) {
    const p = PUSH_CONTRACTS.find((x) => x.id === pid);
    if (p && u.internal.role && !p.recipientRoles.includes(u.internal.role)) e.push(`${u.id}: lists ${pid} but is not a recipient`);
  }
  for (const g of SECURITY_GAPS) for (const who of g.users) if (!users.has(who)) e.push(`${g.id}: unknown user ${who}`);
  return e;
}
