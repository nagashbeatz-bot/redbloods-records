/**
 * Test-only in-memory McpStore that mirrors mcp-oauth-final.sql function semantics 1:1 (burn-on-every-attempt
 * codes, replay → revoke, single-use refresh with family revocation, SQL-side expiry decisions).
 * The SAME scenario suite (scripts/fixtures/mcp-oauth-scenarios.ts) runs against the real SQL in Docker,
 * so any divergence between this mirror and the migration fails there.
 */
import { randomUUID } from "node:crypto";
import type { AccessCheck, AuditRow, GrantResult, McpClientRow, McpStore } from "../../lib/integrations/partner-mcp/store";

interface Tok { id: string; hash: string; kind: "access" | "refresh"; family: string; clientId: string; userId: string; scope: string; resource: string; codeHash: string | null; exp: number; famExp: number; usedAt: number | null; revokedAt: number | null; reason: string | null }
interface Code { hash: string; clientId: string; userId: string; redirectUri: string; challenge: string; scope: string; resource: string; exp: number; consumedAt: number | null; result: string | null }

export interface MemoryMcpStore extends McpStore {
  audit: AuditRow[];
  failAudit: boolean;
  hooks: { ageUnusedClients(): void; expireAccess(): void; expireRefresh(): void; expireCodes(): void; disableClient(id: string): void; revokeAll(): number; activeTokens(): number; counts(): Record<string, number> };
}

export function memoryMcpStore(nowMs: () => number): MemoryMcpStore {
  const clients = new Map<string, McpClientRow>();
  const createdAt = new Map<string, number>();
  const codes = new Map<string, Code>();
  const tokens = new Map<string, Tok>();
  const revokeFamily = (fam: string, reason: string) => { let n = 0; for (const t of tokens.values()) if (t.family === fam && t.revokedAt === null) { t.revokedAt = nowMs(); t.reason = reason; n++; } return n; };
  const issue = (kind: Tok["kind"], hash: string, fam: string, base: { clientId: string; userId: string; scope: string; resource: string }, exp: number, famExp: number, codeHash: string | null) =>
    tokens.set(hash, { id: randomUUID(), hash, kind, family: fam, ...base, codeHash, exp, famExp, usedAt: null, revokedAt: null, reason: null });
  const store: MemoryMcpStore = {
    audit: [], failAudit: false,
    async registerClient(i) {
      const active = [...clients.values()].filter((c) => !c.disabled && ((createdAt.get(c.clientId) ?? 0) > nowMs() - 600_000 || [...tokens.values()].some((t) => t.clientId === c.clientId)));
      if (active.length >= Math.min(Math.max(i.maxActive, 0), 50)) return "LIMIT_REACHED";
      clients.set(i.clientId, { clientId: i.clientId, clientName: i.clientName, redirectUris: i.redirectUris, grantTypes: i.grantTypes, disabled: false });
      createdAt.set(i.clientId, nowMs());
      return "REGISTERED";
    },
    async getClient(id) { const c = clients.get(id); return c ? { ...c } : null; },
    async createCode(i) {
      if (i.ttlSeconds < 30 || i.ttlSeconds > 600) return "INVALID_TTL";
      const c = clients.get(i.clientId);
      if (!c || c.disabled) return "INVALID_CLIENT";
      if (!c.redirectUris.includes(i.redirectUri)) return "INVALID_REDIRECT_URI";
      codes.set(i.codeHash, { hash: i.codeHash, clientId: i.clientId, userId: i.userId, redirectUri: i.redirectUri, challenge: i.codeChallenge, scope: i.scope, resource: i.resource, exp: nowMs() + i.ttlSeconds * 1000, consumedAt: null, result: null });
      return "CREATED";
    },
    async exchangeCode(i): Promise<GrantResult> {
      const c = codes.get(i.codeHash);
      if (!c) return { result: "INVALID_GRANT", reason: "UNKNOWN_CODE" };
      if (c.consumedAt !== null) {
        for (const fam of new Set([...tokens.values()].filter((t) => t.codeHash === i.codeHash).map((t) => t.family))) revokeFamily(fam, "CODE_REPLAY");
        return { result: "INVALID_GRANT", reason: "CODE_REPLAY" };
      }
      const cl = clients.get(c.clientId)!;
      const why = c.exp <= nowMs() ? "EXPIRED" : c.clientId !== i.clientId ? "CLIENT_MISMATCH" : c.redirectUri !== i.redirectUri ? "REDIRECT_MISMATCH"
        : cl.disabled ? "CLIENT_DISABLED" : i.resource !== null && c.resource !== i.resource ? "RESOURCE_MISMATCH" : c.challenge !== i.challengeFromVerifier ? "PKCE_FAILED" : null;
      c.consumedAt = nowMs(); c.result = why ?? "ISSUED";
      if (why) return { result: why === "RESOURCE_MISMATCH" ? "INVALID_TARGET" : "INVALID_GRANT", reason: why };
      const fam = randomUUID(), famExp = nowMs() + i.familyTtl * 1000;
      const base = { clientId: c.clientId, userId: c.userId, scope: c.scope, resource: c.resource };
      const accExp = Math.min(nowMs() + i.accessTtl * 1000, famExp);
      issue("access", i.accessHash, fam, base, accExp, famExp, i.codeHash);
      issue("refresh", i.refreshHash, fam, base, Math.min(nowMs() + i.refreshTtl * 1000, famExp), famExp, i.codeHash);
      return { result: "ISSUED", userId: c.userId, scope: c.scope, resource: c.resource, accessExpiresAt: new Date(accExp).toISOString() };
    },
    async rotateRefresh(i): Promise<GrantResult> {
      const t = tokens.get(i.refreshHash);
      if (!t || t.kind !== "refresh") return { result: "INVALID_GRANT", reason: "UNKNOWN_TOKEN" };
      if (t.clientId !== i.clientId) return { result: "INVALID_GRANT", reason: "CLIENT_MISMATCH" };
      if (t.revokedAt !== null) return { result: "INVALID_GRANT", reason: "REVOKED" };
      if (t.usedAt !== null) { revokeFamily(t.family, "REFRESH_REPLAY"); return { result: "INVALID_GRANT", reason: "REFRESH_REPLAY" }; }
      if (t.exp <= nowMs() || t.famExp <= nowMs()) return { result: "INVALID_GRANT", reason: "EXPIRED" };
      if (clients.get(t.clientId)!.disabled) return { result: "INVALID_GRANT", reason: "CLIENT_DISABLED" };
      if (i.resource !== null && i.resource !== t.resource) return { result: "INVALID_TARGET", reason: "RESOURCE_MISMATCH" };
      t.usedAt = nowMs();
      const base = { clientId: t.clientId, userId: t.userId, scope: t.scope, resource: t.resource };
      const accExp = Math.min(nowMs() + i.accessTtl * 1000, t.famExp);
      issue("access", i.newAccessHash, t.family, base, accExp, t.famExp, null);
      issue("refresh", i.newRefreshHash, t.family, base, Math.min(nowMs() + i.refreshTtl * 1000, t.famExp), t.famExp, null);
      return { result: "ISSUED", userId: t.userId, scope: t.scope, resource: t.resource, accessExpiresAt: new Date(accExp).toISOString() };
    },
    async checkAccess(hash): Promise<AccessCheck> {
      const t = tokens.get(hash);
      if (!t || t.kind !== "access") return { result: "NOT_FOUND" };
      const r = t.revokedAt !== null ? "REVOKED" : t.exp <= nowMs() ? "EXPIRED" : clients.get(t.clientId)!.disabled ? "CLIENT_DISABLED" : "VALID";
      return { result: r, tokenId: t.id, clientId: t.clientId, userId: t.userId, scope: t.scope, resource: t.resource };
    },
    async revokeToken(hash, clientId) { const t = tokens.get(hash); if (t && t.clientId === clientId) revokeFamily(t.family, "REVOKED_BY_CLIENT"); },
    async writeAudit(row) { if (store.failAudit) throw new Error("audit unavailable"); store.audit.push(row); },
    hooks: {
      ageUnusedClients() { for (const k of createdAt.keys()) createdAt.set(k, nowMs() - 3_600_000); },
      expireAccess() { for (const t of tokens.values()) if (t.kind === "access") t.exp = nowMs() - 1000; },
      expireRefresh() { for (const t of tokens.values()) if (t.kind === "refresh") t.exp = nowMs() - 1000; },
      expireCodes() { for (const c of codes.values()) c.exp = nowMs() - 1000; },
      disableClient(id) { const c = clients.get(id); if (c) c.disabled = true; },
      revokeAll() { let n = 0; for (const t of tokens.values()) if (t.revokedAt === null) { t.revokedAt = nowMs(); t.reason = "REVOKE_ALL"; n++; } return n; },
      activeTokens() { return [...tokens.values()].filter((t) => t.revokedAt === null && t.exp > nowMs()).length; },
      counts() { return { clients: clients.size, codes: codes.size, tokens: tokens.size, audit: store.audit.length }; },
    },
  };
  return store;
}
