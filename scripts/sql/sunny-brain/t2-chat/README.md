# t2-chat — the Owner decides a pending Sunny request from the Claude chat

**Status: CANDIDATE — NOT applied to production.** It needs the Owner's explicit approval before it runs.

## Why a DB change is needed
The T2 decide function proves the Owner from his Supabase session JWT. The Claude connector never holds that JWT,
only its own service key. Without this change, a "chat approval" could only be the service role claiming the
Owner approved, which is forbidden. This adds ONE new proof that the DATABASE checks itself: possession of the
Owner's LIVE connector access token. The DB receives its sha256 hash; it already stores only hashes, and the
service role cannot read the token table.

## Run order (Supabase SQL editor, one file at a time)
1. `T2MCP-PREFLIGHT-readonly.sql` — SELECT only. Every row must say OK. If any row says STOP, stop.
2. Optional: `2026-10-XX-t2-mcp-owner-decide-CANDIDATE-DRYRUN.sql`. It is the same as step 3 but ends in ROLLBACK, so it leaves nothing.
3. `2026-10-XX-t2-mcp-owner-decide-CANDIDATE.sql` — one transaction. It checks preconditions first and postconditions last; any failure rolls back everything.
4. `T2MCP-VERIFY-readonly.sql` — SELECT only. Every row must say OK.
5. On the connector service only: set `PARTNER_MCP_OWNER_DECIDE_ENABLED=true`. Observe stays on. No new consent is needed.

Rollback: `…-CANDIDATE-rollback.sql`. It restores the exact original decide function (md5 c0a7f209…) and both CHECKs.
It refuses to run once any decision with role `mcp_owner_token` exists, so history is never orphaned.

## SHA-256
    becf15f9447aaf5af6eb4088ee5068180f0b79424dafe6c13b19333259ca5d99  2026-10-XX-t2-mcp-owner-decide-CANDIDATE-DRYRUN.sql
    c6d17dba8a4b7ce390f694a5adc6cd3548788c16735c2933bf0e43131c6f7e2b  2026-10-XX-t2-mcp-owner-decide-CANDIDATE-rollback-DRYRUN.sql
    61691a9e41f83422c1592ac351d43f23abb944f590418cd28bf6b517f2a58382  2026-10-XX-t2-mcp-owner-decide-CANDIDATE-rollback.sql
    65887395f8033167390f9cf137b4cc2c8da8a166de0ffe3d46f625bfcb3f1d90  2026-10-XX-t2-mcp-owner-decide-CANDIDATE.sql
    954d7a4bdafc5b6fde7fde67121d64c949f9a30a1eb03d3d5d6bbd869f177f57  T2MCP-PREFLIGHT-readonly.sql
    48f28793228dd220b19b40c433a60a4db789e5821bdc281f7b929216949effb4  T2MCP-VERIFY-readonly.sql

## Local proof (Postgres 16 harness, no production connection)
- `harness/run.sh` — 50 security checks (A grants · B token proof · C exact / once · D reject · E dashboard · F CHECKs · G cancelled).
- `harness/lifecycle.sh` — 15 lifecycle checks: dry-runs leave nothing; re-run refused; rollback restores the exact original;
  rollback refused after chat decisions; the existing 129-check Brain / T2 security suite still passes after the migration.
- `harness/e2e-chat.tsx` — 17 checks: the real TS chat flow → the real migrated DB.
- `harness/aug-tokens.sql` gives the harness the PRODUCTION shape of `partner_mcp_check_access` (a jsonb result).
- The shell scripts expect the v4 harness layout (`harness/fresh.sh`, `tests/10-security.sql`) next to this folder.
